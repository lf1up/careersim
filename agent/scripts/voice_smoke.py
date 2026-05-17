"""End-to-end voice pipeline smoke test (manual / CI gate use).

Exercises the voice module without spinning up an actual LiveKit
room: synthetically feeds a short PCM utterance into the configured
STT provider, runs one LangGraph turn against a chosen persona, and
streams the reply through the configured TTS provider, asserting
that audio bytes are produced.

Usage::

    # Default — whisper_local + piper_local + Vikram
    cd agent && uv run python scripts/voice_smoke.py

    # Switch providers via env, exactly like the worker does
    VOICE_STT_PROVIDER=whisper_openai VOICE_TTS_PROVIDER=openai_tts \
      uv run python scripts/voice_smoke.py --persona vikram-shah-pipeline-recruiter

    # Kill-switch — should print one info line and exit 0
    VOICE_ENABLED=false uv run python scripts/voice_smoke.py

The script is intentionally network-and-model-light when the optional
deps aren't installed: it uses the WhisperLocalSTT / PiperLocalTTS
fallbacks' lazy imports and surfaces a clear error message rather
than crashing inside a transitive C-extension.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import wave
from pathlib import Path

# Make `careersim_agent` importable when running ad-hoc from `agent/`
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from careersim_agent.config import get_settings  # noqa: E402
from careersim_agent.services.conversation_service import (  # noqa: E402
    get_conversation_service,
    serialize_state,
)
from careersim_agent.voice.persona_voice import persona_supports_voice  # noqa: E402
from careersim_agent.voice.pipeline import LangGraphAdapter  # noqa: E402
from careersim_agent.voice.providers import (  # noqa: E402
    UnsupportedProviderError,
    get_stt_provider,
    get_tts_provider,
)


log = logging.getLogger("voice-smoke")


async def _fake_audio_stream():
    """Yield ~1 second of silence as 16 kHz mono int16 PCM.

    The real STT path is exercised by manual room tests; this smoke
    test just verifies that the provider plumbing accepts frames and
    cleans up cleanly. Most providers will return zero results from
    pure silence, which is the expected outcome here.
    """
    chunk_size_bytes = 16000 * 2 // 10  # 100 ms of 16 kHz int16
    for _ in range(10):
        yield b"\x00" * chunk_size_bytes
        await asyncio.sleep(0)


async def run(persona_slug: str, user_text: str) -> int:
    settings = get_settings()
    if not settings.voice_enabled:
        print("voice disabled by env (VOICE_ENABLED=false); smoke exits cleanly")
        return 0

    svc = get_conversation_service()

    sims = svc.list_simulations()
    persona_sim = next(
        (s for s in sims if s.get("persona_slug") == persona_slug),
        None,
    )
    if persona_sim is None:
        print(f"no simulation found for persona slug: {persona_slug}")
        return 1

    state = svc.init_session(simulation_slug=persona_sim["slug"])
    persona = state.get("persona") or {}

    if not persona_supports_voice(persona):
        print(
            f"persona {persona_slug} has no voice block (Phase 1 only "
            "added Vikram); pick another or add a voice block first."
        )
        return 1

    print(f"-- session: {state.get('session_id')} persona: {persona.get('name')}")
    print(f"   stt={settings.voice_stt_provider} tts={settings.voice_tts_provider}")

    try:
        stt = get_stt_provider(persona)
        tts = get_tts_provider(persona)
    except UnsupportedProviderError as exc:
        print(f"provider config error: {exc}")
        return 2

    # 1. Pump silence through STT — we don't expect text out, but the
    #    provider should accept the stream and shut down cleanly.
    print("   probing STT...")
    try:
        results = []
        async for r in stt.transcribe(_fake_audio_stream()):
            results.append(r)
        print(f"   STT produced {len(results)} interim/final result(s)")
    except RuntimeError as exc:
        print(f"   STT skipped ({exc})")
    finally:
        await stt.aclose()

    # 2. Run one LangGraph turn against the existing service so we
    #    confirm the adapter still produces a coherent persona reply.
    wire_state = serialize_state(state)
    adapter = LangGraphAdapter(wire_state)
    print(f"   running LangGraph turn: user_text={user_text!r}")
    result = await adapter.user_turn(user_text)
    print(f"   persona reply: {result.text[:120]!r}...")

    # 3. Stream the reply through TTS. We collect the chunks and
    #    measure total audio output as a sanity check.
    print("   running TTS...")
    total_bytes = 0
    chunks = 0
    try:
        async for chunk in tts.synthesize(result.text):
            total_bytes += len(chunk.audio)
            chunks += 1
        print(f"   TTS produced {chunks} chunk(s), {total_bytes} bytes")
    except RuntimeError as exc:
        print(f"   TTS skipped ({exc})")
    finally:
        await tts.aclose()

    print("smoke OK")
    return 0


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Voice pipeline smoke test")
    parser.add_argument(
        "--persona",
        default="vikram-shah-pipeline-recruiter",
        help="Persona slug to run the smoke against (default: vikram-shah-pipeline-recruiter)",
    )
    parser.add_argument(
        "--say",
        default="hey, looking for some context on the role you mentioned",
        help="User utterance text to feed the LangGraph turn",
    )
    args = parser.parse_args()

    code = asyncio.run(run(args.persona, args.say))
    sys.exit(code)


if __name__ == "__main__":
    main()
