"""STT / TTS provider abstraction for voice mode.

Two Protocols (:class:`STTProvider`, :class:`TTSProvider`) plus six
concrete implementations behind lazy imports — ``whisper_local`` /
``whisper_openai`` / ``deepgram`` for STT, ``piper_local`` /
``openai_tts`` / ``elevenlabs`` for TTS.

OpenRouter has no provider name of its own: it isn't OpenAI-SDK-compatible
for audio, so the ``whisper_openai`` / ``openai_tts`` providers detect an
OpenRouter ``OPENAI_BASE_URL`` and adapt their request shape internally
(see :func:`.base.is_openrouter_base_url`).

The factory functions :func:`get_stt_provider` and
:func:`get_tts_provider` are the only public way to instantiate a
provider in production code: they read the env-level provider
selection and resolve any per-persona overrides via
:mod:`..persona_voice`. Tests should construct concrete providers
directly (or fakes) rather than going through the factory, so the
factory's env reads stay simple and unmocked.
"""

from __future__ import annotations

from typing import Any, Optional

from ...config import get_settings
from ..persona_voice import (
    resolve_active_tts_provider,
    resolve_voice_provider_config,
)
from .base import (
    STTProvider,
    STTResult,
    TTSAudioChunk,
    TTSProvider,
    UnsupportedProviderError,
)


def get_stt_provider(
    persona: Optional[dict[str, Any]] = None,
    *,
    settings_override: Any = None,
) -> STTProvider:
    """Return an instantiated STT provider for this session.

    The persona argument is currently unused — STT providers don't
    differ per-persona — but it's part of the signature so the
    matching :func:`get_tts_provider` and :func:`get_stt_provider`
    look symmetric to callers and so we have a place to plug in
    persona-specific accent / language hints later.
    """
    settings = settings_override if settings_override is not None else get_settings()
    name = settings.voice_stt_provider

    if name == "whisper_local":
        from .whisper_local import WhisperLocalSTT

        return WhisperLocalSTT(
            model=settings.voice_whisper_model,
            device=settings.voice_whisper_device,
            compute_type=settings.voice_whisper_compute_type,
        )
    if name == "whisper_openai":
        from .whisper_openai import WhisperOpenAISTT

        if not settings.openai_api_key and not settings.openai_base_url:
            raise UnsupportedProviderError(
                "whisper_openai STT selected but neither OPENAI_API_KEY nor "
                "OPENAI_BASE_URL is set"
            )
        # WhisperOpenAISTT internally switches to OpenRouter's JSON+base64
        # contract when the base URL points at OpenRouter (the SDK's
        # multipart upload is rejected there).
        return WhisperOpenAISTT(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            model=settings.voice_whisper_openai_model,
            default_headers=settings.openai_default_headers,
        )
    if name == "deepgram":
        from .deepgram import DeepgramSTT

        if not settings.deepgram_api_key:
            raise UnsupportedProviderError(
                "deepgram STT selected but DEEPGRAM_API_KEY is not set"
            )
        return DeepgramSTT(api_key=settings.deepgram_api_key)

    raise UnsupportedProviderError(f"unknown STT provider: {name!r}")


def get_tts_provider(
    persona: dict[str, Any],
    *,
    settings_override: Any = None,
) -> TTSProvider:
    """Return an instantiated TTS provider for this persona+session.

    Resolution order:

    1. ``persona.voice.providerOverride`` (per-persona pin) wins over
       the global default; see
       :func:`..persona_voice.resolve_active_tts_provider`.
    2. ``settings.voice_tts_provider`` is the global default.

    The persona's per-provider config block (e.g. ElevenLabs voice
    ID) is fetched via
    :func:`..persona_voice.resolve_voice_provider_config` and
    forwarded to the concrete provider constructor.
    """
    settings = settings_override if settings_override is not None else get_settings()
    name = resolve_active_tts_provider(
        persona,
        global_default=settings.voice_tts_provider,
    )
    persona_cfg = resolve_voice_provider_config(persona, name) or {}

    if name == "piper_local":
        from .piper_local import PiperLocalTTS

        return PiperLocalTTS(
            model_dir=settings.voice_piper_model_dir,
            default_voice=settings.voice_piper_default_voice,
            persona_config=persona_cfg,
        )
    if name == "openai_tts":
        from .openai_tts import OpenAITTS

        if not settings.openai_api_key and not settings.openai_base_url:
            raise UnsupportedProviderError(
                "openai_tts selected but neither OPENAI_API_KEY nor "
                "OPENAI_BASE_URL is set"
            )
        # OpenAITTS swaps in the OpenRouter model slug automatically when
        # the base URL points at OpenRouter (its `/audio/speech` is
        # otherwise OpenAI-SDK-compatible).
        return OpenAITTS(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            persona_config=persona_cfg,
            openrouter_model=settings.voice_openai_tts_model,
            default_headers=settings.openai_default_headers,
        )
    if name == "elevenlabs":
        from .elevenlabs import ElevenLabsTTS

        if not settings.elevenlabs_api_key:
            raise UnsupportedProviderError(
                "elevenlabs TTS selected but ELEVENLABS_API_KEY is not set"
            )
        if "voiceId" not in persona_cfg:
            raise UnsupportedProviderError(
                "elevenlabs TTS requires `voice.providers.elevenlabs.voiceId` "
                "on the persona"
            )
        return ElevenLabsTTS(
            api_key=settings.elevenlabs_api_key,
            persona_config=persona_cfg,
        )

    raise UnsupportedProviderError(f"unknown TTS provider: {name!r}")


__all__ = [
    "STTProvider",
    "STTResult",
    "TTSAudioChunk",
    "TTSProvider",
    "UnsupportedProviderError",
    "get_stt_provider",
    "get_tts_provider",
]
