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
from typing import Any, AsyncIterator

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

    import os

    # LiveKit Agents runs a small HTTP status server (used here as the
    # container's readiness/liveness endpoint). It defaults to :8081, but
    # most managed platforms inject ``$PORT`` and point their readiness
    # probe at that same port — so bind to ``$PORT`` when present and fall
    # back to 8081 for local/compose. ``HEALTH_HOST`` lets you pin the bind
    # address if the platform probes a specific interface.
    health_port = int(os.environ.get("PORT") or os.environ.get("HEALTH_PORT") or 8081)
    health_host = os.environ.get("HEALTH_HOST", "0.0.0.0")

    # Cold-start of the job subprocess imports the full voice stack
    # (onnxruntime / CTranslate2 / silero / av), which routinely exceeds
    # the SDK's 10s default on small instances — the framework then kills
    # and respawns the process (the SIGUSR1 / exit -10 churn). Give it more
    # headroom so startup is clean. Override via ``VOICE_INIT_TIMEOUT``.
    init_timeout = float(os.environ.get("VOICE_INIT_TIMEOUT") or 30.0)

    # ``cli.run_app`` is LiveKit Agents' own Click-based CLI; it
    # re-parses ``sys.argv`` and expects one of its subcommands
    # (start/dev/connect/...). Our process was launched as
    # ``python -m careersim_agent.main --serve voice``, so we must
    # replace argv with a LiveKit-compatible invocation or it dies
    # with "No such option '--serve'". ``start`` is the production
    # mode that registers the worker with the SFU and waits for the
    # API to dispatch rooms.
    sys.argv = [sys.argv[0], "start"]
    cli.run_app(  # blocks until SIGINT
        WorkerOptions(
            entrypoint_fnc=_voice_entrypoint,
            host=health_host,
            port=health_port,
            initialize_process_timeout=init_timeout,
        ),
    )
    return 0


def _extract_ai_reply(detail: Any) -> str:
    """Pull the persona's freshly-appended reply out of a SessionDetail.

    ``POST /sessions/:id/messages`` returns the full message list; the new
    persona burst is the run of trailing ``ai`` messages after the last
    ``human`` message. Multi-bubble bursts are joined with an ellipsis to
    mirror the chat transcript's visual cadence (and so we don't talk over
    ourselves between bubbles).
    """
    if not isinstance(detail, dict):
        return ""
    messages = detail.get("messages")
    if not isinstance(messages, list):
        return ""
    msgs = [m for m in messages if isinstance(m, dict)]
    try:
        msgs.sort(key=lambda m: m.get("order_index", 0))
    except Exception:
        pass
    trailing: list[str] = []
    for msg in reversed(msgs):
        role = msg.get("role")
        if role == "ai":
            content = msg.get("content")
            if isinstance(content, str) and content.strip():
                trailing.append(content.strip())
        elif role == "human":
            break
    trailing.reverse()
    return " … ".join(trailing)


async def _resolve_session_metadata(room: Any) -> tuple[str, str] | None:
    """Pull ``(session_id, bearer_token)`` out of room/participant metadata.

    The API encodes both values as JSON when minting the LiveKit join
    token. Because that metadata is attached to the *participant* (LiveKit
    scopes ``AccessToken.metadata`` to the participant, not the room), we
    look there first — falling back to ``room.metadata`` in case a future
    deploy sets room-level metadata via the RoomService API.

    Returns ``None`` if neither carries a usable payload (after a short
    grace period waiting for the user participant to connect).
    """
    import asyncio
    import json

    def _parse(raw: str | None) -> tuple[str, str] | None:
        raw = (raw or "").strip()
        if not raw:
            return None
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            return None
        sid = str(obj.get("session_id") or "")
        tok = str(obj.get("bearer_token") or "")
        return (sid, tok) if sid and tok else None

    def _scan() -> tuple[str, str] | None:
        # Room first (forward-compat), then any remote participant.
        found = _parse(getattr(room, "metadata", None))
        if found:
            return found
        for participant in list(room.remote_participants.values()):
            found = _parse(getattr(participant, "metadata", None))
            if found:
                return found
        return None

    # The user usually joins before the agent is dispatched, but poll for a
    # few seconds to absorb any ordering race without hanging the worker.
    for _ in range(25):
        found = _scan()
        if found:
            return found
        await asyncio.sleep(0.2)
    return None


async def _voice_entrypoint(ctx: Any) -> None:
    """Per-room entry point invoked by the LiveKit Agents runtime.

    Each call mints a brand-new :class:`LangGraphAdapter` for the
    room from the wire-format state pulled out of the API. The join
    token's metadata carries ``session_id`` + ``bearer_token`` (set
    when the API mints the token in :file:`api/src/modules/voice`);
    LiveKit attaches it to the user *participant*, so we read it via
    :func:`_resolve_session_metadata`.

    NOTE: this MUST stay a module-level function (not a closure inside
    :func:`run_worker`). LiveKit Agents runs each job in a separate
    process and pickles the entrypoint by qualified name to hand it to
    the worker subprocess; a local closure fails with
    ``Can't pickle local object``.
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

    # Session ID + bearer token arrive as JSON metadata minted by the API
    # when it issues the join token. LiveKit's ``AccessToken.metadata`` is
    # *participant*-scoped, so this JSON lands on the user participant's
    # ``.metadata`` — not ``room.metadata``. We read it off the participant
    # (with a room-metadata fallback for forward compatibility), waiting a
    # few seconds for the user to connect if the agent got here first.
    resolved = await _resolve_session_metadata(room)
    if resolved is None:
        logger.warning(
            "room %s: no session metadata on room or participants; "
            "cannot resolve session",
            room.name,
        )
        return
    session_id, bearer = resolved

    api = APIClient.from_env()
    try:
        wire_state = await api.fetch_state_for_voice(session_id)
    except Exception:
        logger.exception("failed to fetch state-for-voice; aborting room")
        await api.aclose()
        return

    # Authoritative remaining budget for the mid-call cutoff. Best-effort:
    # if the lookup fails (or quota is disabled) we proceed without a cap
    # rather than blocking the call — the API start gate already vetted it.
    max_duration_sec: float | None = None
    cap_seconds: float | None = None
    try:
        budget = await api.fetch_voice_budget(session_id)
        remaining = budget.get("remaining_seconds")
        cap = budget.get("cap_seconds")
        if isinstance(remaining, (int, float)):
            max_duration_sec = max(0.0, float(remaining))
        if isinstance(cap, (int, float)):
            cap_seconds = float(cap)
        logger.info(
            "session %s: voice budget remaining=%ss cap=%ss",
            session_id,
            max_duration_sec,
            cap_seconds,
        )
    except Exception:
        logger.exception(
            "failed to fetch voice budget for %s; no mid-call cutoff armed",
            session_id,
        )

    adapter = LangGraphAdapter(wire_state)
    persona = adapter.persona
    captions = LiveKitCaptionPublisher(room)

    # Resolve per-persona voice tunings up-front so the loop
    # below doesn't re-read the persona dict on every turn. The
    # struct is frozen — safe to share across coroutines.
    from .persona_voice import resolve_voice_tuning
    tuning = resolve_voice_tuning(persona)
    logger.info(
        "voice tuning for %s: rate=%dwpm silence=%dms barge_in=%dms fillers=%s",
        persona.get("slug") or "<unknown>",
        tuning.speaking_rate_wpm,
        tuning.silence_threshold_ms,
        tuning.barge_in_tolerance_ms,
        tuning.filler_word_frequency,
    )

    stt = None
    try:
        stt = get_stt_provider(persona)
        tts = get_tts_provider(persona)
    except Exception as exc:
        logger.error("provider init failed for %s: %s", session_id, exc)
        # Close anything already constructed so a failed init doesn't
        # leak the API client or a half-initialized STT provider.
        if stt is not None:
            try:
                await stt.aclose()
            except Exception:
                logger.exception("stt cleanup failed after provider init error")
        await api.aclose()
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
            tuning=tuning,
            max_duration_sec=max_duration_sec,
            cap_seconds=cap_seconds,
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
    tuning: object,
    max_duration_sec: float | None = None,
    cap_seconds: float | None = None,
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
    * ``tuning.barge_in_tolerance_ms`` is the minimum sustained user
      audio (in ms) required before the SDK cancels in-flight TTS;
      it maps to silero VAD's ``min_speech_duration_ms`` on the room
      input and is what makes Marcus tolerate throat-clears while
      Chloe reacts to the slightest peep.
    * ``tuning.silence_threshold_ms`` is the watchdog after which
      the persona will *initiate* an inactivity nudge (mirroring the
      chat-side ``inactivityNudgeDelaySec`` knob).
    * ``max_duration_sec`` (when not ``None``) is the hard daily-budget
      cutoff. A watchdog warns the user ~60s out (control event +
      spoken heads-up) and then ends the room when the budget is spent.
      ``cap_seconds`` is the configured daily cap, forwarded to the
      client so its alert copy reflects the real limit.

    Implementation notes:

    * Agent → room audio is an :class:`rtc.AudioSource` published as a
      microphone track; TTS PCM chunks are captured straight into it.
    * Room → agent audio is read via :class:`rtc.AudioStream` (resampled
      to the STT provider's rate) and segmented into utterances by a
      silero VAD. Each utterance is handed to ``stt.transcribe`` — our
      providers buffer-then-transcribe, so VAD segmentation is what gives
      them an utterance boundary.
    * ``tuning.barge_in_tolerance_ms`` maps to the VAD's
      ``min_speech_duration``; when the user starts speaking over the
      persona we cancel the in-flight reply + playback (barge-in).
    * Turn handling runs in its own task so the VAD loop stays responsive
      for barge-in while the persona is talking.
    """
    import asyncio
    import contextlib
    import time

    import livekit.rtc as rtc
    from livekit.agents import vad as vad_module
    from livekit.plugins import silero

    from ..services.eval_service import VoiceTurnMetadata
    from .persona_voice import VoiceTuning
    from .pipeline import LangGraphAdapter
    from .transcripts import Caption

    assert isinstance(adapter, LangGraphAdapter)
    assert isinstance(tuning, VoiceTuning)

    room = ctx.room  # type: ignore[attr-defined]
    loop = asyncio.get_running_loop()

    # ---- agent -> room audio output ---------------------------------------
    # WebRTC audio sources only accept sample rates that divide into clean
    # 10 ms frames (8k / 16k / 24k / 48k). Piper emits 22050 Hz, which does
    # NOT (220.5 samples per 10 ms), so capturing it directly fails with
    # "InvalidState - failed to capture frame". We therefore publish a 48 kHz
    # source (Opus's native rate) and resample the TTS output into it.
    OUT_RATE = 48000
    tts_rate = tts.output_sample_rate()  # type: ignore[attr-defined]
    source = rtc.AudioSource(OUT_RATE, 1)
    out_track = rtc.LocalAudioTrack.create_audio_track("agent-voice", source)
    await room.local_participant.publish_track(
        out_track,
        rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
    )

    # Shared mutable state between the playback and VAD coroutines.
    speak_state: dict[str, Any] = {
        "speaking": False,
        "task": None,        # asyncio.Task | None — current TTS pump
        "ai_audio_sec": 0.0,  # duration of the last AI utterance
        "last_turn_end": None,  # monotonic ts when the last turn finished
        "interrupted": False,
    }

    async def _pump(text: str) -> None:
        played = 0.0
        # Resample provider PCM up to the 48 kHz source rate when needed.
        # The resampler also re-frames into capturable 10 ms blocks.
        resampler = (
            rtc.AudioResampler(tts_rate, OUT_RATE, num_channels=1)
            if tts_rate != OUT_RATE
            else None
        )

        async def _capture(pcm: bytes) -> None:
            nonlocal played
            samples = len(pcm) // 2  # 16-bit mono
            if samples <= 0:
                return
            in_frame = rtc.AudioFrame(pcm, tts_rate, 1, samples)
            if resampler is None:
                played += samples / float(tts_rate)
                await source.capture_frame(in_frame)
                return
            for out_frame in resampler.push(in_frame):
                played += out_frame.samples_per_channel / float(OUT_RATE)
                await source.capture_frame(out_frame)

        async for chunk in tts.synthesize(text):  # type: ignore[attr-defined]
            if chunk.audio:
                await _capture(chunk.audio)
        if resampler is not None:
            for out_frame in resampler.flush():
                played += out_frame.samples_per_channel / float(OUT_RATE)
                await source.capture_frame(out_frame)
        await source.wait_for_playout()
        speak_state["ai_audio_sec"] = played

    async def speak(text: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        await captions.publish(Caption(role="ai", text=text, is_final=True))  # type: ignore[attr-defined]
        speak_state["speaking"] = True
        speak_state["interrupted"] = False
        task = loop.create_task(_pump(text))
        speak_state["task"] = task
        try:
            await task
        except asyncio.CancelledError:
            speak_state["interrupted"] = True
        finally:
            speak_state["speaking"] = False
            speak_state["task"] = None
            speak_state["last_turn_end"] = time.monotonic()

    async def barge_in() -> None:
        await adapter.cancel_inflight()  # type: ignore[attr-defined]
        task = speak_state.get("task")
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        with contextlib.suppress(Exception):
            source.clear_queue()
        speak_state["speaking"] = False

    # ---- opening turn (persona speaks first, if configured) ----------------
    opening = await adapter.opening_turn()  # type: ignore[attr-defined]
    if opening is not None and opening.text:
        await speak(opening.text)
        adapter.record_voice_turn(  # type: ignore[attr-defined]
            VoiceTurnMetadata(
                role="ai",
                transcript=opening.text,
                audio_start_sec=0.0,
                audio_end_sec=speak_state["ai_audio_sec"],
            )
        )

    # ---- locate the user's (auto-subscribed) microphone track --------------
    user_track = None
    for _ in range(50):  # up to ~10s
        for participant in list(room.remote_participants.values()):
            for pub in list(participant.track_publications.values()):
                trk = getattr(pub, "track", None)
                if trk is not None and trk.kind == rtc.TrackKind.KIND_AUDIO:
                    user_track = trk
                    break
            if user_track is not None:
                break
        if user_track is not None:
            break
        await asyncio.sleep(0.2)

    if user_track is None:
        logger.warning(
            "session %s: no user audio track subscribed; ending room",
            session_id,
        )
        return

    # ---- input pipeline: AudioStream -> silero VAD -> STT -> LangGraph ------
    stt_rate = stt.input_sample_rate()  # type: ignore[attr-defined]
    vad = silero.VAD.load(
        min_speech_duration=max(0.05, tuning.barge_in_tolerance_ms / 1000.0),
        min_silence_duration=0.55,
        sample_rate=16000,
    )
    vad_stream = vad.stream()
    audio_stream = rtc.AudioStream(user_track, sample_rate=stt_rate, num_channels=1)

    done = asyncio.Event()

    def _on_disconnected(*_args: Any) -> None:
        done.set()

    def _on_participant_left(*_args: Any) -> None:
        # End promptly when the human hangs up rather than waiting for the
        # SFU's empty-room departure timeout.
        if not room.remote_participants:
            done.set()

    room.on("disconnected", _on_disconnected)
    room.on("participant_disconnected", _on_participant_left)

    async def _forward_frames() -> None:
        try:
            async for ev in audio_stream:
                vad_stream.push_frame(ev.frame)
        except Exception:
            logger.exception("session %s: audio forward loop crashed", session_id)
        finally:
            done.set()

    async def _handle_utterance(frames: list[Any]) -> None:
        if not frames:
            return

        async def _pcm() -> AsyncIterator[bytes]:
            for f in frames:
                yield bytes(f.data)

        speech_start = time.monotonic()
        prior_end = speak_state.get("last_turn_end")
        finals: list[str] = []
        try:
            async for r in stt.transcribe(_pcm()):  # type: ignore[attr-defined]
                await captions.publish(  # type: ignore[attr-defined]
                    Caption(
                        role="user",
                        text=r.text,
                        is_final=r.is_final,
                        confidence=r.confidence,
                    )
                )
                if r.is_final and r.text.strip():
                    finals.append(r.text.strip())
        except Exception:
            logger.exception("session %s: STT failed", session_id)
            return

        text = " ".join(finals).strip()
        if not text:
            return

        spoken = sum(
            f.samples_per_channel / float(getattr(f, "sample_rate", stt_rate) or stt_rate)
            for f in frames
        )
        adapter.record_voice_turn(  # type: ignore[attr-defined]
            VoiceTurnMetadata(
                role="human",
                transcript=text,
                audio_start_sec=0.0,
                audio_end_sec=spoken,
                prior_turn_ended_sec=(
                    None if prior_end is None else max(0.0, speech_start - prior_end)
                ),
            )
        )

        # Persist + generate the reply through the SAME path as text chat:
        # POST /sessions/:id/messages runs `agent.turn` server-side. Using it
        # as the single source of truth means the spoken reply equals the
        # saved transcript (so the chat view updates), and goal eval /
        # sentiment / nudges all run exactly once. We deliberately do NOT
        # also run the graph locally via the adapter — that would double the
        # LLM cost and let the spoken reply drift from what's persisted.
        # Shield the POST so a barge-in cancellation (``turn_task.cancel()``
        # in ``_consume_vad``) can't tear down the connection mid-request.
        # ``post_user_message`` runs ``agent.turn`` server-side — appending
        # the human turn and generating the AI reply — and that mutation
        # must complete atomically so the persisted transcript stays
        # consistent. On cancel we let ``CancelledError`` propagate (the
        # shielded request still finishes server-side); we simply don't
        # speak the now-superseded reply.
        try:
            detail = await asyncio.shield(
                api.post_user_message(  # type: ignore[attr-defined]
                    session_id, text, bearer_token=bearer_token
                )
            )
        except Exception:
            logger.exception("session %s: post_user_message failed", session_id)
            return

        reply = _extract_ai_reply(detail)
        if reply:
            await speak(reply)
            adapter.record_voice_turn(  # type: ignore[attr-defined]
                VoiceTurnMetadata(
                    role="ai",
                    transcript=reply,
                    audio_start_sec=0.0,
                    audio_end_sec=speak_state["ai_audio_sec"],
                    was_interrupted=speak_state["interrupted"],
                )
            )

    # Hoisted to the enclosing scope so the outer teardown can join the
    # last in-flight utterance task before closing the shared
    # vad_stream/audio_stream/source it may still be writing into.
    turn_task: asyncio.Task[None] | None = None

    async def _consume_vad() -> None:
        nonlocal turn_task
        try:
            async for ev in vad_stream:
                if ev.type == vad_module.VADEventType.START_OF_SPEECH:
                    if speak_state["speaking"]:
                        await barge_in()
                elif ev.type == vad_module.VADEventType.END_OF_SPEECH:
                    # Serialize turns: a new utterance supersedes any
                    # still-running prior turn.
                    if turn_task is not None and not turn_task.done():
                        turn_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError, Exception):
                            await turn_task
                    turn_task = loop.create_task(_handle_utterance(list(ev.frames)))
        except Exception:
            logger.exception("session %s: VAD consume loop crashed", session_id)
        finally:
            done.set()

    async def _budget_watchdog(cap: float) -> None:
        """Hard daily-budget cutoff: warn ~60s out, then end the room.

        Reuses the same ``done`` event the disconnect/VAD paths use, so
        the existing teardown (and the authoritative ``report_call_end``
        in the entrypoint's ``finally``) runs unchanged.
        """
        cap_total = int(cap_seconds) if cap_seconds else None
        try:
            warn_at = max(0.0, cap - 60.0)
            await asyncio.sleep(warn_at)
            await captions.publish_control(  # type: ignore[attr-defined]
                {
                    "type": "quota_warning",
                    "remaining_seconds": max(0, int(round(cap - warn_at))),
                    "cap_seconds": cap_total,
                }
            )
            # A short spoken heads-up, but only if we're not mid-utterance
            # so we don't clobber an in-flight reply.
            if not speak_state["speaking"]:
                with contextlib.suppress(Exception):
                    await speak(
                        "Heads up — you have about a minute of voice time "
                        "left for today."
                    )
            await asyncio.sleep(max(0.0, cap - warn_at))
            await captions.publish_control(  # type: ignore[attr-defined]
                {"type": "quota_exhausted", "cap_seconds": cap_total}
            )
            # Give the client a beat to render the alert before teardown.
            await asyncio.sleep(1.5)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("session %s: budget watchdog crashed", session_id)
        finally:
            done.set()

    forward_task = loop.create_task(_forward_frames())
    consume_task = loop.create_task(_consume_vad())
    watchdog_task = (
        loop.create_task(_budget_watchdog(max_duration_sec))
        if max_duration_sec is not None
        else None
    )
    try:
        await done.wait()
    finally:
        for task in (forward_task, consume_task, watchdog_task):
            if task is not None and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        # Join the last in-flight utterance task (spawned by _consume_vad)
        # before tearing down shared resources — _handle_utterance may
        # still be writing TTS PCM into `source` via speak().
        if turn_task is not None and not turn_task.done():
            turn_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await turn_task
        with contextlib.suppress(Exception):
            await vad_stream.aclose()
        with contextlib.suppress(Exception):
            await audio_stream.aclose()
        with contextlib.suppress(Exception):
            await source.aclose()


def main() -> None:
    """CLI entry point — used by ``--serve voice`` in main.py."""
    code = run_worker()
    sys.exit(code)


if __name__ == "__main__":  # pragma: no cover
    main()
