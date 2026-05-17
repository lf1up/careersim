"""Tests for voice-mode prompt augmentation in build_persona_system_prompt."""

from __future__ import annotations

import pytest

from careersim_agent.prompts import build_persona_system_prompt
from careersim_agent.prompts.templates import _format_voice_style


CHLOE = {
    "slug": "chloe-davis-anxious-junior",
    "name": "Chloe Davis",
    "role": "Eager but Anxious Junior",
    "personality": "Ambitious, hardworking",
    "primaryGoal": "Understand the task",
    "hiddenMotivation": "Imposter syndrome",
    "difficultyLevel": 3,
    "conversationStyle": {"tone": "Eager", "typingSpeedWpm": 135},
    "voice": {
        "speakingRateWpm": 170,
        "fillerWordFrequency": "high",
        "providers": {"piper_local": {"voiceModel": "en_US-amy-medium"}},
    },
}

DAVID = {
    "slug": "david-miller-skeptical-veteran",
    "name": "David Miller",
    "role": "Senior Analyst",
    "personality": "Data-driven",
    "primaryGoal": "Protect the team",
    "hiddenMotivation": "Wants expertise valued",
    "difficultyLevel": 4,
    "conversationStyle": {"tone": "Skeptical", "typingSpeedWpm": 120},
    "voice": {
        "speakingRateWpm": 115,
        "fillerWordFrequency": "low",
        "providers": {"piper_local": {"voiceModel": "en_US-hfc_male-medium"}},
    },
}

PERSONA_NO_VOICE = {
    "slug": "no-voice",
    "name": "No Voice",
    "role": "Test",
    "personality": "Test",
    "primaryGoal": "Test",
    "hiddenMotivation": "Test",
    "difficultyLevel": 3,
    "conversationStyle": {"tone": "Test"},
}

SIM = {
    "slug": "sim",
    "title": "Test Simulation",
    "scenario": "A test scenario",
    "objectives": ["objective one"],
    "conversationGoals": [
        {
            "goalNumber": 1,
            "title": "Goal one",
            "description": "Do the thing",
            "keyBehaviors": ["b1"],
            "isOptional": False,
        }
    ],
}


class TestFormatVoiceStyleHelper:
    def test_high_filler_frequency_emits_block(self) -> None:
        out = _format_voice_style(CHLOE)
        assert "Voice-mode style" in out
        assert "frequent" in out.lower() or "anxious" in out.lower()
        assert "spoken" in out.lower()

    def test_low_filler_frequency_emits_quiet_guidance(self) -> None:
        out = _format_voice_style(DAVID)
        assert "Voice-mode style" in out
        assert "Almost no fillers" in out

    def test_no_voice_block_returns_empty(self) -> None:
        assert _format_voice_style(PERSONA_NO_VOICE) == ""

    def test_cadence_hint_reflects_speaking_rate(self) -> None:
        # Fast persona (170 wpm) should mention short / energetic clauses.
        out = _format_voice_style(CHLOE)
        assert "short" in out.lower()
        # Slow persona (115 wpm) should mention deliberate sentences.
        out_slow = _format_voice_style(DAVID)
        assert "deliberate" in out_slow.lower()


class TestBuildPersonaSystemPromptVoiceMode:
    def test_voice_mode_appends_voice_block(self) -> None:
        text_prompt = build_persona_system_prompt(CHLOE, SIM, voice_mode=False)
        voice_prompt = build_persona_system_prompt(CHLOE, SIM, voice_mode=True)

        assert "Voice-mode style" not in text_prompt
        assert "Voice-mode style" in voice_prompt

    def test_voice_mode_default_is_text(self) -> None:
        # Calling without the kwarg must keep the text-mode behaviour
        # so existing callers don't accidentally flip semantics.
        text_prompt = build_persona_system_prompt(CHLOE, SIM)
        assert "Voice-mode style" not in text_prompt

    def test_voice_mode_no_voice_block_persona_is_clean(self) -> None:
        # Personas without a `voice` block don't get a voice section
        # even when voice_mode=True (it's just an empty append).
        prompt = build_persona_system_prompt(
            PERSONA_NO_VOICE, SIM, voice_mode=True
        )
        assert "Voice-mode style" not in prompt

    def test_voice_mode_block_warns_against_markdown(self) -> None:
        # Critical for TTS quality: the prompt must explicitly steer
        # the LLM away from emitting bullets/headings/markdown.
        prompt = build_persona_system_prompt(CHLOE, SIM, voice_mode=True)
        assert "markdown" in prompt.lower()
