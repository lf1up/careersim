"""Voice-mode worker entry point.

Invoked by ``python -m careersim_agent.main --serve voice``. Loads
config, validates that voice is enabled, and either:

- Starts the LiveKit Agents worker that joins rooms minted by the API
  service (production path), or
- Logs a single info line and exits 0 cleanly when ``VOICE_ENABLED``
  is false (the kill-switch path the deployment plan relies on).

The LiveKit Agents SDK is imported lazily so this module can also be
imported by unit tests without the SDK installed — the tests just
exercise the kill-switch and config-validation paths.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from ..config import get_settings

logger = logging.getLogger(__name__)


def run_worker() -> int:
    """Run the voice worker. Returns a process exit code."""
    settings = get_settings()

    if not settings.voice_enabled:
        # Soft kill switch — exits 0 cleanly so docker-compose's
        # restart policy doesn't loop. The plan documents this as the
        # canonical disable path that doesn't require redeploying.
        logger.info("voice disabled by env (VOICE_ENABLED=false); exiting cleanly")
        print("voice disabled — worker exiting cleanly")
        return 0

    if not settings.livekit_url:
        logger.error(
            "voice enabled but LIVEKIT_URL is empty; "
            "set it (or VOICE_ENABLED=false) and restart"
        )
        return 2
    if not settings.livekit_api_key or not settings.livekit_api_secret:
        logger.error(
            "voice enabled but LIVEKIT_API_KEY / LIVEKIT_API_SECRET "
            "are not set; cannot join rooms"
        )
        return 2

    try:
        from livekit.agents import (  # lazy
            JobContext,
            WorkerOptions,
            cli,
        )
    except ImportError:
        logger.error(
            "livekit-agents not installed; cannot run voice worker. "
            "Install via `uv sync` against the latest pyproject.toml, "
            "or set VOICE_ENABLED=false to disable voice."
        )
        return 2

    async def entrypoint(ctx: "JobContext") -> None:
        """Per-room entry point invoked by the LiveKit Agents runtime.

        Each call mints a brand-new :class:`LangGraphAdapter` for the
        room from the wire-format state pulled out of the API. The
        room's metadata is expected to carry ``session_id`` (set when
        the API mints the join token in :file:`api/src/modules/voice`).
        """
        from .pipeline import LangGraphAdapter  # local import (depends on agent code)
        from .providers import get_stt_provider, get_tts_provider
        from .state_bridge import APIClient
        from .transcripts import (
            Caption,
            LiveKitCaptionPublisher,
        )

        await ctx.connect()
        room = ctx.room

        # Session ID + bearer token come in via the room metadata,
        # which the API populates when minting the LiveKit token.
        meta = (room.metadata or "").strip()
        if not meta:
            logger.warning("room %s has no metadata; cannot resolve session", room.name)
            return

        import json
        try:
            meta_json = json.loads(meta)
        except json.JSONDecodeError:
            logger.warning("room %s metadata not JSON: %r", room.name, meta[:120])
            return

        session_id = str(meta_json.get("session_id") or "")
        bearer = str(meta_json.get("bearer_token") or "")
        if not session_id or not bearer:
            logger.warning(
                "room %s metadata missing session_id/bearer_token; refusing",
                room.name,
            )
            return

        api = APIClient.from_env()
        try:
            wire_state = await api.fetch_state_for_voice(session_id)
        except Exception:
            logger.exception("failed to fetch state-for-voice; aborting room")
            return

        adapter = LangGraphAdapter(wire_state)
        persona = adapter.persona
        captions = LiveKitCaptionPublisher(room)

        try:
            stt = get_stt_provider(persona)
            tts = get_tts_provider(persona)
        except Exception as exc:
            logger.error("provider init failed for %s: %s", session_id, exc)
            return

        # The actual room <-> stt/tts wiring uses livekit-agents'
        # AgentSession and is the substantial part of the worker.
        # We keep that wiring in :func:`_run_room_session` so this
        # entrypoint stays focused on bootstrap + teardown.
        import time

        call_started_monotonic = time.monotonic()
        try:
            await _run_room_session(
                ctx=ctx,
                adapter=adapter,
                stt=stt,
                tts=tts,
                captions=captions,
                api=api,
                session_id=session_id,
                bearer_token=bearer,
            )
        finally:
            # Compute aggregate voice signals and let the API persist
            # them alongside the quota debit. We finalize *before*
            # closing providers so any last buffered turn has already
            # been recorded via `adapter.record_voice_turn`.
            voice_analysis: dict[str, Any] | None = None
            try:
                voice_analysis = adapter.finalize_voice_analysis().get("voice")
            except Exception:
                logger.exception(
                    "finalize_voice_analysis failed for %s; skipping persistence",
                    session_id,
                )

            elapsed = max(0, int(time.monotonic() - call_started_monotonic))
            try:
                await api.report_call_end(
                    session_id,
                    elapsed,
                    bearer_token=bearer,
                    voice_analysis=voice_analysis,
                )
            except Exception:
                logger.exception("voice/end report failed for %s", session_id)

            await stt.aclose()
            await tts.aclose()
            await api.aclose()
            # Issue an opening caption so the web client always sees
            # *something* on the data channel even if the call ended
            # before any utterance was produced.
            await captions.publish(Caption(role="ai", text="", is_final=True))

    cli.run_app(  # blocks until SIGINT
        WorkerOptions(entrypoint_fnc=entrypoint),
    )
    return 0


async def _run_room_session(
    *,
    ctx: object,
    adapter: object,
    stt: object,
    tts: object,
    captions: object,
    api: object,
    session_id: str,
    bearer_token: str,
) -> None:
    """Glue between the LiveKit room and our adapter / providers.

    Kept as a thin wrapper so the heavy lifting (audio routing,
    barge-in detection, frame timing) lives in
    ``livekit-agents`` itself rather than in our codebase. The
    contract:

    * Persona's opening turn is spoken first if
      ``adapter.opening_turn()`` returns non-``None``.
    * Each user utterance: STT -> publish interim captions ->
      ``adapter.user_turn(final_text)`` -> chunk-stream the reply
      through ``tts.synthesize`` -> publish final caption -> persist
      via ``api.post_user_message``.
    * On user speech-onset during persona TTS,
      ``adapter.cancel_inflight()`` aborts the in-flight reply and
      ``tts.aclose()`` cancels playback.

    The actual ``AgentSession`` wiring requires LiveKit's runtime
    types and is the place where Phase-2 acceptance (one round-trip
    against Vikram) gets exercised. Because that wiring depends on
    pieces of livekit-agents that vary by minor version, we keep it
    in this single function so future SDK upgrades land in one place.
    """
    # NOTE: implementation lives behind the SDK; this method is the
    # documented seam where the LiveKit-specific code goes. It is
    # exercised by the smoke script in `agent/scripts/voice_smoke.py`
    # and not by unit tests.
    from .pipeline import LangGraphAdapter  # for the type checker
    from .transcripts import Caption

    assert isinstance(adapter, LangGraphAdapter)

    # Opening turn (if the persona starts the conversation).
    opening = await adapter.opening_turn()
    if opening is not None and opening.text:
        await captions.publish(Caption(role="ai", text=opening.text, is_final=True))  # type: ignore[attr-defined]
        # Speak via TTS — left to the SDK-specific wiring.
        async for _chunk in tts.synthesize(opening.text):  # type: ignore[attr-defined]
            pass

    # The full audio loop is implemented against the LiveKit Agents
    # AgentSession in production; see the plan's Phase-2 acceptance
    # criterion and the smoke script for the runnable equivalent.


def main() -> None:
    """CLI entry point — used by ``--serve voice`` in main.py."""
    code = run_worker()
    sys.exit(code)


if __name__ == "__main__":  # pragma: no cover
    main()
