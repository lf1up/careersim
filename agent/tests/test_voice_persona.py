"""Tests for the read-only persona-voice helpers."""

from __future__ import annotations

import pytest

from careersim_agent.voice.persona_voice import (
    get_barge_in_tolerance_ms,
    get_filler_word_frequency,
    get_silence_threshold_ms,
    get_speaking_rate_wpm,
    persona_supports_voice,
    resolve_active_tts_provider,
    resolve_voice_provider_config,
)


VIKRAM = {
    "slug": "vikram-shah-pipeline-recruiter",
    "name": "Vikram Shah",
    "conversationStyle": {
        "typingSpeedWpm": 150,
        "inactivityNudgeDelaySec": {"min": 30, "max": 90},
        "burstiness": {"min": 1, "max": 3},
    },
    "voice": {
        "speakingRateWpm": 135,
        "silenceThresholdMs": 30000,
        "bargeInToleranceMs": 200,
        "fillerWordFrequency": "medium",
        "providers": {
            "piper_local": {"voiceModel": "en_US-ryan-high"},
            "openai_tts": {"voice": "echo", "speed": 1.05},
            "elevenlabs": {"voiceId": "pNInz6obpgDQGcFmaJgB", "stability": 0.4},
        },
        "providerOverride": None,
    },
}

PERSONA_NO_VOICE = {
    "slug": "brenda-vance-hr-manager",
    "conversationStyle": {
        "typingSpeedWpm": 110,
        "inactivityNudgeDelaySec": {"min": 180, "max": 300},
    },
}


class TestPersonaSupportsVoice:
    def test_voice_block_with_providers(self) -> None:
        assert persona_supports_voice(VIKRAM) is True

    def test_no_voice_block(self) -> None:
        assert persona_supports_voice(PERSONA_NO_VOICE) is False

    def test_empty_voice_block(self) -> None:
        assert persona_supports_voice({"voice": {}}) is False

    def test_empty_providers_dict(self) -> None:
        assert persona_supports_voice({"voice": {"providers": {}}}) is False

    def test_non_dict_input(self) -> None:
        assert persona_supports_voice(None) is False  # type: ignore[arg-type]
        assert persona_supports_voice("vikram") is False  # type: ignore[arg-type]


class TestResolveActiveTTSProvider:
    def test_falls_back_to_global_default(self) -> None:
        assert (
            resolve_active_tts_provider(VIKRAM, global_default="piper_local")
            == "piper_local"
        )
        assert (
            resolve_active_tts_provider(VIKRAM, global_default="elevenlabs")
            == "elevenlabs"
        )

    def test_persona_override_wins(self) -> None:
        persona = dict(VIKRAM)
        persona["voice"] = dict(VIKRAM["voice"])  # type: ignore[arg-type]
        persona["voice"]["providerOverride"] = "elevenlabs"  # type: ignore[index]
        assert (
            resolve_active_tts_provider(persona, global_default="piper_local")
            == "elevenlabs"
        )

    def test_falsy_override_ignored(self) -> None:
        persona = dict(VIKRAM)
        persona["voice"] = dict(VIKRAM["voice"])  # type: ignore[arg-type]
        persona["voice"]["providerOverride"] = ""  # type: ignore[index]
        assert (
            resolve_active_tts_provider(persona, global_default="piper_local")
            == "piper_local"
        )


class TestResolveProviderConfig:
    def test_returns_provider_block(self) -> None:
        cfg = resolve_voice_provider_config(VIKRAM, "elevenlabs")
        assert cfg is not None
        assert cfg["voiceId"] == "pNInz6obpgDQGcFmaJgB"

    def test_missing_provider(self) -> None:
        assert resolve_voice_provider_config(VIKRAM, "deepgram_tts") is None

    def test_no_voice_block(self) -> None:
        assert resolve_voice_provider_config(PERSONA_NO_VOICE, "piper_local") is None

    def test_returns_copy_not_alias(self) -> None:
        cfg = resolve_voice_provider_config(VIKRAM, "openai_tts")
        assert cfg is not None
        cfg["voice"] = "tampered"
        assert VIKRAM["voice"]["providers"]["openai_tts"]["voice"] == "echo"  # type: ignore[index]


class TestSpeakingRateWpm:
    def test_voice_block_value_wins(self) -> None:
        assert get_speaking_rate_wpm(VIKRAM) == 135

    def test_falls_back_to_typing_speed(self) -> None:
        # 110 wpm * 0.9 = 99
        assert get_speaking_rate_wpm(PERSONA_NO_VOICE) == 99

    def test_default_when_no_data(self) -> None:
        assert get_speaking_rate_wpm({}, default=150) == 150


class TestSilenceThresholdMs:
    def test_voice_block_value_wins(self) -> None:
        assert get_silence_threshold_ms(VIKRAM) == 30000

    def test_falls_back_to_inactivity_nudge_delay(self) -> None:
        # 180s * 1000 = 180000ms
        assert get_silence_threshold_ms(PERSONA_NO_VOICE) == 180000

    def test_default_when_no_data(self) -> None:
        assert get_silence_threshold_ms({}, default=4000) == 4000


class TestBargeInToleranceMs:
    def test_voice_block_value_wins(self) -> None:
        assert get_barge_in_tolerance_ms(VIKRAM) == 200

    def test_default_when_unset(self) -> None:
        assert get_barge_in_tolerance_ms(PERSONA_NO_VOICE, default=400) == 400


class TestFillerWordFrequency:
    def test_voice_block_value_wins(self) -> None:
        assert get_filler_word_frequency(VIKRAM) == "medium"

    def test_invalid_value_falls_back(self) -> None:
        persona = {"voice": {"fillerWordFrequency": "extreme"}}
        assert get_filler_word_frequency(persona) == "low"

    def test_default(self) -> None:
        assert get_filler_word_frequency({}) == "low"
