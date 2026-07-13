"""Turn aggregation for the voice worker: buffer, debounce, abandon, re-run.

The voice pipeline segments user speech with a VAD, so one spoken answer
routinely arrives as several utterances (natural pauses, rapid follow-up
remarks). This module owns the policy for composing those utterances into
conversation turns:

- Every finalised utterance is buffered in ``pending_texts``.
- A short debounce (:data:`UTTERANCE_DEBOUNCE_SEC`) absorbs natural pauses
  before ONE turn is fired with the whole buffer — the API persists each
  item as its own transcript bubble while the persona composes a single
  reply to the batch.
- Abandon-and-rerun: when a new finalised utterance lands while a reply
  stream is still in flight (its terminal ``done`` not yet seen), the
  stream is aborted — the API persists nothing before ``done``, so the
  abort is clean — and a new turn is fired with ALL pending utterances.
- ``pending_texts`` is cleared only when a stream's ``done`` confirms the
  turn was committed server-side, so utterances can never be silently
  dropped by a cancellation.
- Teardown ``flush()`` drains the in-flight turn (or fires one final
  unspoken turn for any uncommitted utterances) so a brief last remark
  still reaches the transcript.

Kept LiveKit-free so it is unit-testable; the worker wires in the real
API client, TTS ``speak`` coroutine, and metadata recording via callbacks.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any, Awaitable, Callable, Optional

from .state_bridge import TurnConflictError

logger = logging.getLogger(__name__)

# How long to wait after a finalised utterance before firing the turn.
# Natural mid-answer pauses routinely split one spoken response into
# several VAD utterances; this debounce composes them into ONE turn
# instead of abandoning and re-running the reply stream on every pause.
UTTERANCE_DEBOUNCE_SEC = 1.2

# Soft timeout on the *first* reply bubble of a turn. When the LLM /
# API stream stalls past this, the worker logs a warning and speaks a
# short filler so the user isn't left in dead silence. The SSE read
# timeout stays disabled (long multi-bubble turns are legitimate) —
# this only makes a stall visible, it never aborts the turn.
FIRST_BUBBLE_SOFT_TIMEOUT_SEC = 20.0
STALL_FILLER_TEXT = "Sorry, give me a moment. I'm still thinking."

# Upper bound on the teardown flush (draining the last in-flight turn to
# its `done` event so the transcript persists) so a hung API can never
# wedge worker shutdown.
TEARDOWN_FLUSH_TIMEOUT_SEC = 60.0


class TurnManager:
    """Owns the utterance buffer and the single in-flight turn.

    All methods must be called from the same event loop. The manager
    holds no LiveKit state — audio/caption side effects are injected:

    Args:
        session_id: Session the turns belong to.
        bearer_token: User bearer forwarded to the streaming endpoint.
        api: ``state_bridge.APIClient``-compatible object. Uses
            ``stream_user_message`` (list-of-texts form) and
            ``fetch_state_for_voice`` (abort/commit reconciliation).
        speak: Coroutine that TTS-plays one reply bubble.
        on_ai_bubble: Called after each spoken bubble (metadata recording).
        speak_state: The worker's shared playback dict — reads/writes the
            ``turn_interrupted`` barge-in latch.
        on_turn_event: Optional coroutine called with ``"superseded"``
            when an in-flight turn is abandoned (its already-spoken
            bubbles no longer reflect what will be persisted) and
            ``"committed"`` when a turn's ``done`` confirms the server
            persisted it. The worker forwards these to the client as
            caption-grouping control messages.
        debounce_sec / first_bubble_soft_timeout_sec / stall_filler /
        flush_timeout_sec: Tunables, overridable in tests.
    """

    def __init__(
        self,
        *,
        session_id: str,
        bearer_token: str,
        api: Any,
        speak: Callable[[str], Awaitable[None]],
        on_ai_bubble: Callable[[str], None],
        speak_state: dict[str, Any],
        on_turn_event: Optional[Callable[[str], Awaitable[None]]] = None,
        debounce_sec: float = UTTERANCE_DEBOUNCE_SEC,
        first_bubble_soft_timeout_sec: float = FIRST_BUBBLE_SOFT_TIMEOUT_SEC,
        stall_filler: str = STALL_FILLER_TEXT,
        flush_timeout_sec: float = TEARDOWN_FLUSH_TIMEOUT_SEC,
    ) -> None:
        self._session_id = session_id
        self._bearer_token = bearer_token
        self._api = api
        self._speak = speak
        self._on_ai_bubble = on_ai_bubble
        self._speak_state = speak_state
        self._on_turn_event = on_turn_event
        self._debounce_sec = debounce_sec
        self._first_bubble_soft_timeout_sec = first_bubble_soft_timeout_sec
        self._stall_filler = stall_filler
        self._flush_timeout_sec = flush_timeout_sec

        # Finalised utterances not yet committed by a `done` event.
        self.pending_texts: list[str] = []
        self._task: Optional[asyncio.Task[None]] = None
        self._done = False  # current turn's stream saw its terminal `done`
        self._debounce: Optional[asyncio.Task[None]] = None
        self._closing = False
        # Optimistic precondition for the next turn request: the
        # transcript length observed by the last `_reconcile_pending`.
        # None ⇒ no precondition (nothing raced, e.g. a fresh turn).
        self._expected_count: Optional[int] = None

    # -- utterance intake ---------------------------------------------------

    async def on_final_text(self, text: str) -> None:
        """Buffer a finalised utterance; abandon an in-flight turn if needed.

        If a reply is currently being generated (stream open, no ``done``
        yet) it no longer answers everything the user said — abort it and
        let the debounced re-run fire ONE new turn with the full buffer.
        """
        self.pending_texts.append(text)
        task = self._task
        if task is not None and not task.done() and not self._done:
            logger.info(
                "session %s: new utterance during reply generation; "
                "abandoning turn to re-run with %d utterance(s)",
                self._session_id,
                len(self.pending_texts),
            )
            task.cancel()
            # `asyncio.wait` so the aborted turn's CancelledError isn't
            # re-raised into this coroutine (which must go on to re-run).
            await asyncio.wait([task])
            # Already-spoken bubbles from the abandoned reply no longer
            # match what will be persisted — tell the client to drop them.
            await self._emit_turn_event("superseded")
            # The abort races the turn's terminal `done`: the API may have
            # committed the turn right before we closed the SSE. Drop any
            # pending texts that are already in the persisted transcript so
            # the re-run can't duplicate them. The reconcile also records
            # the transcript length, which the re-run sends as an
            # optimistic precondition — if the aborted stream's commit
            # lands AFTER this fetch, the re-run gets a 409 (and
            # reconciles again) instead of silently duplicating.
            await self._reconcile_pending()
        self.arm_debounce()

    def arm_debounce(self) -> None:
        """(Re)start the short timer that fires the next turn.

        Every new finalised utterance restarts it, so natural mid-answer
        pauses are absorbed into one turn instead of one abort+re-run per
        pause.
        """
        if self._closing:
            return
        prev = self._debounce
        if prev is not None and not prev.done():
            prev.cancel()

        async def _fire() -> None:
            try:
                await asyncio.sleep(self._debounce_sec)
            except asyncio.CancelledError:
                return
            await self._start_pending_turn()

        self._debounce = asyncio.get_running_loop().create_task(_fire())

    def hold_debounce(self) -> None:
        """Pause the pending turn — the user started speaking again.

        Called on VAD speech onset; ``on_final_text`` (or the empty-STT
        path re-calling :meth:`arm_debounce`) restarts the timer once the
        new utterance is finalised.
        """
        debounce = self._debounce
        if debounce is not None and not debounce.done():
            debounce.cancel()

    # -- teardown -----------------------------------------------------------

    async def flush(self) -> None:
        """Drain the persistence path before the worker closes.

        1. An in-flight turn drains to its ``done`` so the API persists it.
        2. Any still-uncommitted utterances get ONE final (unspoken) turn
           so nothing the user said is lost from the transcript.

        Bounded by ``flush_timeout_sec`` so a hung API can't wedge
        shutdown.
        """
        self._closing = True
        debounce = self._debounce
        if debounce is not None and not debounce.done():
            debounce.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await debounce

        task = self._task
        if task is not None and not task.done():
            try:
                await asyncio.wait_for(
                    asyncio.shield(task), timeout=self._flush_timeout_sec
                )
            except (asyncio.TimeoutError, Exception):
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        if self.pending_texts:
            logger.info(
                "session %s: flushing %d uncommitted utterance(s) at teardown",
                self._session_id,
                len(self.pending_texts),
            )
            try:
                await asyncio.wait_for(
                    self._run_turn_with_retry(
                        list(self.pending_texts), speak_replies=False
                    ),
                    timeout=self._flush_timeout_sec,
                )
            except (asyncio.TimeoutError, Exception):
                logger.exception(
                    "session %s: teardown flush turn failed", self._session_id
                )

    # -- internals ----------------------------------------------------------

    async def _emit_turn_event(self, kind: str) -> None:
        if self._on_turn_event is None:
            return
        try:
            await self._on_turn_event(kind)
        except Exception:
            logger.exception(
                "session %s: turn event %r publish failed", self._session_id, kind
            )

    async def _reconcile_pending(self) -> None:
        """Drop pending texts the aborted stream already committed.

        Also records the observed transcript length in
        ``_expected_count`` so the next turn request carries it as an
        optimistic precondition.
        """
        if not self.pending_texts:
            return
        try:
            state = await self._api.fetch_state_for_voice(self._session_id)
        except Exception:
            logger.exception(
                "session %s: pending-reconcile state fetch failed; "
                "keeping full buffer",
                self._session_id,
            )
            return
        msgs = state.get("messages") or []
        self._expected_count = len(msgs)
        tail = [
            str(m.get("content") or "").strip()
            for m in msgs[-(len(self.pending_texts) + 8):]
            if isinstance(m, dict) and m.get("role") == "human"
        ]
        dropped = 0
        while self.pending_texts and self.pending_texts[0].strip() in tail:
            tail.remove(self.pending_texts.pop(0).strip())
            dropped += 1
        if dropped:
            logger.info(
                "session %s: %d pending utterance(s) were already committed "
                "by the aborted stream; dropped from re-run",
                self._session_id,
                dropped,
            )

    async def _start_pending_turn(self) -> None:
        # A previous turn may still be speaking already-committed bubbles;
        # let it finish so turns stay strictly ordered. `asyncio.wait` (not
        # a bare await) so the prev turn's error/cancellation isn't
        # re-raised here, while OUR own cancellation (a newer debounce
        # superseding this one) still propagates and aborts the start.
        prev = self._task
        if prev is not None and not prev.done():
            await asyncio.wait([prev])
        if not self.pending_texts or self._closing:
            return
        texts = list(self.pending_texts)
        self._task = asyncio.get_running_loop().create_task(
            self._run_turn_with_retry(texts)
        )

    async def _run_turn_with_retry(
        self, texts: list[str], *, speak_replies: bool = True
    ) -> None:
        conflicted = await self._run_turn(texts, speak_replies=speak_replies)
        attempts = 0
        while conflicted and not self._done and attempts < 2:
            attempts += 1
            # Another commit landed between the API's load and persist —
            # either a genuinely different writer (voice-end analytics
            # merge) or our own aborted predecessor, whose commit raced
            # the abort. Reconcile against the now-durable transcript so
            # the retry only re-sends utterances that truly aren't
            # committed yet — blindly retrying the same batch would
            # duplicate whatever the other commit already persisted.
            logger.warning(
                "session %s: turn conflict from API; reconciling and "
                "retrying (attempt %d)",
                self._session_id,
                attempts,
            )
            await self._reconcile_pending()
            texts = list(self.pending_texts)
            if not texts:
                logger.info(
                    "session %s: all utterances of the conflicted turn were "
                    "already committed; nothing to retry",
                    self._session_id,
                )
                # The batch IS in the transcript (the aborted predecessor
                # committed it) — the turn is effectively done.
                await self._emit_turn_event("committed")
                return
            conflicted = await self._run_turn(texts, speak_replies=speak_replies)

    async def _run_turn(self, texts: list[str], *, speak_replies: bool = True) -> bool:
        """Send ONE turn with all buffered utterances and speak the reply.

        Persist + generate through the SAME path as text chat, streamed so
        each bubble (main reply + follow-up bursts) is spoken as it is
        generated. POST /sessions/:id/messages/stream runs the graph
        server-side and persists the full delta on its terminal `done`
        event, so goal eval / sentiment / nudges still run exactly once and
        the spoken reply equals the saved transcript.

        Cancelling this coroutine aborts the SSE (closing the connection
        cancels the server-side graph run) — that is the abandon path.
        Returns True when the API reported a retryable TURN_CONFLICT.
        """
        self._done = False
        self._speak_state["turn_interrupted"] = False
        bubbles: "asyncio.Queue[str | None]" = asyncio.Queue()
        turn_started = time.monotonic()
        conflict = {"hit": False}
        logger.info(
            "session %s: streaming turn with %d utterance(s)",
            self._session_id,
            len(texts),
        )

        async def _drain() -> None:
            first_bubble = True
            try:
                async for event in self._api.stream_user_message(
                    self._session_id,
                    list(texts),
                    bearer_token=self._bearer_token,
                    expected_message_count=self._expected_count,
                ):
                    etype = event.get("type")
                    if etype == "message":
                        if first_bubble:
                            first_bubble = False
                            logger.info(
                                "session %s: first reply bubble received "
                                "%.1fs after turn start",
                                self._session_id,
                                time.monotonic() - turn_started,
                            )
                        await bubbles.put(event["content"])
                    elif etype == "done":
                        # Committed server-side. The turn's texts are always
                        # a prefix of `pending_texts` (new arrivals append),
                        # so drop exactly that prefix. The precondition is
                        # consumed — the next fresh turn carries none.
                        self._done = True
                        del self.pending_texts[: len(texts)]
                        self._expected_count = None
                    elif etype == "error":
                        if event.get("code") == "TURN_CONFLICT":
                            conflict["hit"] = True
                        logger.error(
                            "session %s: reply stream error: %s",
                            self._session_id,
                            event.get("message"),
                        )
            except TurnConflictError:
                conflict["hit"] = True
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "session %s: stream_user_message failed", self._session_id
                )
            finally:
                # The sentinel always lands so the speaker loop terminates.
                # put_nowait: an `await` here would re-raise during
                # cancellation before enqueueing.
                bubbles.put_nowait(None)

        drain_task = asyncio.get_running_loop().create_task(_drain())
        spoken_bubbles = 0
        stall_notified = False
        try:
            while True:
                if spoken_bubbles == 0 and not stall_notified and speak_replies:
                    # Soft first-bubble watchdog: a stalled LLM / API stream
                    # otherwise produces total silence with nothing in the
                    # logs (the SSE read timeout is deliberately disabled).
                    # Speak a filler once and keep waiting — never abort.
                    try:
                        bubble = await asyncio.wait_for(
                            bubbles.get(),
                            timeout=self._first_bubble_soft_timeout_sec,
                        )
                    except asyncio.TimeoutError:
                        stall_notified = True
                        logger.warning(
                            "session %s: no reply bubble within %.0fs; "
                            "speaking stall filler",
                            self._session_id,
                            self._first_bubble_soft_timeout_sec,
                        )
                        if not self._speak_state["turn_interrupted"]:
                            # The filler is spoken/captioned only — it is
                            # intentionally not persisted (same as the quota
                            # heads-up), so the transcript stays clean.
                            with contextlib.suppress(Exception):
                                await self._speak(self._stall_filler)
                        continue
                else:
                    bubble = await bubbles.get()
                if bubble is None:
                    break
                if self._speak_state["turn_interrupted"] or not speak_replies:
                    # Barge-in without (yet) a superseding utterance: stop
                    # SPEAKING but keep consuming to `done` so the API
                    # persists the full reply. A superseding utterance
                    # cancels this whole task instead (abandon path).
                    continue
                await self._speak(bubble)
                spoken_bubbles += 1
                self._on_ai_bubble(bubble)
            logger.info(
                "session %s: turn complete — spoke %d bubble(s) in %.1fs%s",
                self._session_id,
                spoken_bubbles,
                time.monotonic() - turn_started,
                " (interrupted)" if self._speak_state["turn_interrupted"] else "",
            )
            if self._done:
                # Emitted AFTER the speaker loop so every bubble's caption
                # precedes the committed signal — the client uses it to
                # close the current caption group.
                await self._emit_turn_event("committed")
        finally:
            if not drain_task.done():
                drain_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await drain_task
        return conflict["hit"]
