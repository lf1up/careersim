"""LangGraph adapter for the voice pipeline.

Reuses :class:`ConversationService` verbatim — voice mode is just a
new transport that calls ``invoke_turn(state, transcribed_text)`` once
per finalised user utterance and surfaces the AI reply to the TTS
provider. The graph itself is *not* modified, so every per-turn
behaviour (goal evaluation, sentiment / emotion, RAG, hidden
motivations, proactive checks) is preserved.

The adapter is deliberately **independent of the LiveKit Agents SDK**
so it can be unit-tested without that wheel installed. The LiveKit
binding lives in :mod:`.worker`, which constructs an ``AgentSession``
whose LLM step delegates here. Anything that needs to know about
audio frames, rooms, or RTC events stays out of this file.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

from ..services.conversation_service import (
    ConversationService,
    deserialize_state,
    get_conversation_service,
    serialize_state,
)

logger = logging.getLogger(__name__)


@dataclass
class TurnResult:
    """One assistant turn produced from a user utterance.

    ``text`` is the persona's full reply (concatenated across burst
    messages — voice mode flattens follow-up bursts into one spoken
    response so we don't talk over ourselves). ``new_state`` is the
    serialised wire-format state to persist via the API.
    """
    text: str
    new_state: dict[str, Any]
    burst_messages: list[str] = field(default_factory=list)


class LangGraphAdapter:
    """Thin wrapper around ``ConversationService`` for voice callers.

    Each :class:`LangGraphAdapter` instance is bound to a single
    session — its mutable ``_state`` is the conversation history that
    grows across turns. The adapter is **not** thread-safe; one
    instance per LiveKit room.
    """

    def __init__(
        self,
        initial_state: dict[str, Any],
        *,
        service: Optional[ConversationService] = None,
    ) -> None:
        # We accept the wire-format dict (what the API hands us via
        # `state-for-voice`) and deserialize on the way in so callers
        # don't need to know about LangChain message objects.
        self._state = deserialize_state(initial_state)
        self._service = service or get_conversation_service()
        # Tracks the last in-flight turn so barge-in can cancel it.
        self._inflight: Optional[asyncio.Task[TurnResult]] = None

    # -- Public API used by the LiveKit worker ---------------------------------

    @property
    def session_id(self) -> str:
        sid = self._state.get("session_id", "")
        return str(sid) if sid is not None else ""

    @property
    def persona(self) -> dict[str, Any]:
        persona = self._state.get("persona") or {}
        return dict(persona) if isinstance(persona, dict) else {}

    def current_state_wire(self) -> dict[str, Any]:
        """Return the current state in the API wire format."""
        return serialize_state(self._state)

    async def opening_turn(self) -> Optional[TurnResult]:
        """Run the ``start`` proactive trigger if the persona opens.

        Returns ``None`` when the persona's ``startsConversation`` flag
        resolves to false — in that case the worker should let the
        caller speak first.
        """
        if self._state.get("proactive_trigger") != "start":
            return None
        return await self._run_proactive("start")

    async def user_turn(self, transcript: str) -> TurnResult:
        """Run a user-message turn and return the persona's reply.

        Cancels any in-flight prior turn first so barge-in doesn't
        produce stale audio.
        """
        await self.cancel_inflight()
        loop = asyncio.get_running_loop()
        task = loop.create_task(self._run_turn(transcript))
        self._inflight = task
        try:
            return await task
        finally:
            if self._inflight is task:
                self._inflight = None

    async def cancel_inflight(self) -> None:
        """Cancel any in-flight turn; safe to call multiple times.

        After cancellation we restore the pre-turn snapshot of the
        state so a half-finished generation doesn't leak into the
        history. The barge-in path in the worker calls this on
        user speech-onset.
        """
        if self._inflight is not None and not self._inflight.done():
            self._inflight.cancel()
            try:
                await self._inflight
            except (asyncio.CancelledError, Exception):
                pass
        self._inflight = None

    # -- Internals -------------------------------------------------------------

    async def _run_turn(self, transcript: str) -> TurnResult:
        """Run one user turn through the LangGraph engine."""
        before = list(self._state.get("messages") or [])
        loop = asyncio.get_running_loop()
        # ``invoke_turn`` is sync (LangGraph). Punt to a worker thread
        # so the asyncio loop stays responsive for audio I/O.
        new_state = await loop.run_in_executor(
            None,
            self._service.invoke_turn,
            self._state,
            transcript,
        )
        self._state = new_state
        return self._build_result(before)

    async def _run_proactive(self, trigger: str) -> TurnResult:
        before = list(self._state.get("messages") or [])
        loop = asyncio.get_running_loop()
        new_state = await loop.run_in_executor(
            None,
            self._service.invoke_proactive,
            self._state,
            trigger,  # type: ignore[arg-type]
        )
        self._state = new_state
        return self._build_result(before)

    def _build_result(self, before: list[Any]) -> TurnResult:
        """Extract newly appended AI messages from the post-turn state."""
        all_msgs = self._state.get("messages") or []
        appended = list(all_msgs[len(before):])

        burst: list[str] = []
        for msg in appended:
            # AIMessage from LangChain — duck-type to avoid a hard
            # import at module load (tests pass plain dicts).
            content = getattr(msg, "content", None)
            role = getattr(msg, "type", None)
            if isinstance(msg, dict):
                content = msg.get("content")
                role = msg.get("role")
            if role == "ai" and isinstance(content, str) and content.strip():
                burst.append(content.strip())

        # Voice-mode collapses bursts into one continuous reply with a
        # short pause marker between bubbles ("…"). The web-side chat
        # transcript shows the bubbles individually as they get
        # persisted via POST /messages, so the user sees the textual
        # burst structure even though the audio doesn't pause.
        spoken = " … ".join(burst) if burst else ""

        return TurnResult(
            text=spoken,
            new_state=serialize_state(self._state),
            burst_messages=burst,
        )


async def stream_chunks(
    text: str,
    chunker_size: int = 240,
) -> AsyncIterator[str]:
    """Split a long persona reply into TTS-friendly chunks.

    ElevenLabs' multi-context socket and OpenAI's streaming endpoint
    both prefer sentence-sized chunks (or the first ~250 chars)
    rather than the entire reply at once: it lets them start
    synthesising before the full text is buffered. Piper doesn't
    care, but it's harmless to chunk for it too.
    """
    text = text.strip()
    if not text:
        return

    # Split on sentence boundaries first; fall back to fixed-size
    # windows if a "sentence" is longer than ``chunker_size``.
    import re

    parts = re.split(r"(?<=[.!?…])\s+", text)
    for part in parts:
        if not part:
            continue
        if len(part) <= chunker_size:
            yield part
            continue
        # Long sentence: yield in fixed windows on word boundaries.
        words = part.split()
        buf: list[str] = []
        size = 0
        for w in words:
            if size + len(w) + 1 > chunker_size and buf:
                yield " ".join(buf)
                buf = []
                size = 0
            buf.append(w)
            size += len(w) + 1
        if buf:
            yield " ".join(buf)
