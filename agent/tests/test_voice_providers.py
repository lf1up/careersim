"""Tests for the voice provider factory + Protocol conformance.

Heavy SDKs (faster-whisper, piper, livekit, deepgram) are NOT
required by this suite — every provider impl uses lazy imports, so
we can construct the wrappers and verify their factory wiring + base
metadata without those wheels installed in the test environment.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from careersim_agent.voice.providers import (
    STTProvider,
    TTSProvider,
    UnsupportedProviderError,
    get_stt_provider,
    get_tts_provider,
)
from careersim_agent.voice.providers.deepgram import DeepgramSTT
from careersim_agent.voice.providers.elevenlabs import ElevenLabsTTS
from careersim_agent.voice.providers.openai_tts import OpenAITTS
from careersim_agent.voice.providers.piper_local import PiperLocalTTS
from careersim_agent.voice.providers.whisper_local import WhisperLocalSTT
from careersim_agent.voice.providers.whisper_openai import WhisperOpenAISTT


def _settings(**overrides: Any) -> SimpleNamespace:
    """Build a SimpleNamespace mimicking the bits of Settings the
    factory reads. Lets each test pin one knob without touching env.
    """
    base = dict(
        voice_stt_provider="whisper_local",
        voice_tts_provider="piper_local",
        voice_whisper_model="base.en",
        voice_whisper_device="cpu",
        voice_whisper_compute_type="int8",
        voice_piper_model_dir="/tmp/piper",
        voice_piper_default_voice="en_US-libritts_r-medium",
        deepgram_api_key="",
        elevenlabs_api_key="",
        openai_api_key="sk-fake",
        openai_base_url=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


PERSONA = {
    "slug": "vikram-shah-pipeline-recruiter",
    "voice": {
        "providers": {
            "piper_local": {"voiceModel": "en_US-ryan-high"},
            "openai_tts": {"voice": "echo", "speed": 1.05},
            "elevenlabs": {"voiceId": "vid-123"},
        },
    },
}


# -----------------------------------------------------------------
# STT factory
# -----------------------------------------------------------------

class TestSTTFactory:
    def test_default_is_whisper_local(self) -> None:
        provider = get_stt_provider(PERSONA, settings_override=_settings())
        assert isinstance(provider, WhisperLocalSTT)
        assert provider.name == "whisper_local"
        assert provider.input_sample_rate() == 16000

    def test_whisper_openai(self) -> None:
        s = _settings(voice_stt_provider="whisper_openai")
        provider = get_stt_provider(PERSONA, settings_override=s)
        assert isinstance(provider, WhisperOpenAISTT)

    def test_deepgram_requires_key(self) -> None:
        s = _settings(voice_stt_provider="deepgram")
        with pytest.raises(UnsupportedProviderError, match="DEEPGRAM_API_KEY"):
            get_stt_provider(PERSONA, settings_override=s)

    def test_deepgram_with_key(self) -> None:
        s = _settings(voice_stt_provider="deepgram", deepgram_api_key="dg-fake")
        provider = get_stt_provider(PERSONA, settings_override=s)
        assert isinstance(provider, DeepgramSTT)

    def test_unknown_provider_raises(self) -> None:
        s = _settings(voice_stt_provider="bogus")
        with pytest.raises(UnsupportedProviderError, match="unknown STT provider"):
            get_stt_provider(PERSONA, settings_override=s)


# -----------------------------------------------------------------
# TTS factory
# -----------------------------------------------------------------

class TestTTSFactory:
    def test_default_is_piper_local(self) -> None:
        provider = get_tts_provider(PERSONA, settings_override=_settings())
        assert isinstance(provider, PiperLocalTTS)
        assert provider.name == "piper_local"
        assert provider.output_sample_rate() == 22050

    def test_openai_tts(self) -> None:
        s = _settings(voice_tts_provider="openai_tts")
        provider = get_tts_provider(PERSONA, settings_override=s)
        assert isinstance(provider, OpenAITTS)
        assert provider.output_sample_rate() == 24000

    def test_elevenlabs_requires_key(self) -> None:
        s = _settings(voice_tts_provider="elevenlabs")
        with pytest.raises(UnsupportedProviderError, match="ELEVENLABS_API_KEY"):
            get_tts_provider(PERSONA, settings_override=s)

    def test_elevenlabs_requires_voice_id(self) -> None:
        s = _settings(voice_tts_provider="elevenlabs", elevenlabs_api_key="el-fake")
        persona_no_voice_id = {
            "voice": {"providers": {"elevenlabs": {}}}
        }
        with pytest.raises(UnsupportedProviderError, match="voiceId"):
            get_tts_provider(persona_no_voice_id, settings_override=s)

    def test_elevenlabs_happy_path(self) -> None:
        s = _settings(voice_tts_provider="elevenlabs", elevenlabs_api_key="el-fake")
        provider = get_tts_provider(PERSONA, settings_override=s)
        assert isinstance(provider, ElevenLabsTTS)

    def test_persona_override_wins(self) -> None:
        # Global default piper_local; persona pins elevenlabs (with valid
        # config + key) -> factory should mint an ElevenLabsTTS.
        persona = dict(PERSONA)
        persona["voice"] = dict(PERSONA["voice"])
        persona["voice"]["providerOverride"] = "elevenlabs"
        s = _settings(elevenlabs_api_key="el-fake")
        provider = get_tts_provider(persona, settings_override=s)
        assert isinstance(provider, ElevenLabsTTS)

    def test_unknown_provider_raises(self) -> None:
        s = _settings(voice_tts_provider="bogus")
        with pytest.raises(UnsupportedProviderError, match="unknown TTS provider"):
            get_tts_provider(PERSONA, settings_override=s)


# -----------------------------------------------------------------
# Protocol conformance — sanity check that every concrete provider
# is `runtime_checkable`-compatible with the Protocols. Catches
# accidental method renames before they reach the worker.
# -----------------------------------------------------------------

class TestProtocolConformance:
    def test_stt_impls_satisfy_protocol(self) -> None:
        impls = [
            WhisperLocalSTT(),
            WhisperOpenAISTT(api_key="sk-fake"),
            DeepgramSTT(api_key="dg-fake"),
        ]
        for impl in impls:
            assert isinstance(impl, STTProvider), f"{impl.name} fails STTProvider"

    def test_tts_impls_satisfy_protocol(self) -> None:
        impls = [
            PiperLocalTTS(model_dir="/tmp", default_voice="x"),
            OpenAITTS(api_key="sk-fake"),
            ElevenLabsTTS(api_key="el-fake", persona_config={"voiceId": "vid"}),
        ]
        for impl in impls:
            assert isinstance(impl, TTSProvider), f"{impl.name} fails TTSProvider"
