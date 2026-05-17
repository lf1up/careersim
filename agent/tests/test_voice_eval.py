"""Unit tests for the voice-aware evaluation helpers.

These exercise :func:`compute_voice_signals` over hand-crafted turn
metadata so we can pin pacing math, filler detection, and silence
analysis without spinning up the full LangGraph engine.
"""

from __future__ import annotations

import pytest

from careersim_agent.services.eval_service import (
    VoiceSignals,
    VoiceTurnMetadata,
    _count_fillers,
    compute_voice_signals,
    voice_signals_to_dict,
)


# -----------------------------------------------------------------
# Filler detection
# -----------------------------------------------------------------


def test_count_fillers_single_tokens() -> None:
    assert _count_fillers("um, I think it's, uh, fine.") == 2


def test_count_fillers_phrase_hedges() -> None:
    text = "you know, the thing is, I mean, sort of, kind of."
    # "you know" + "I mean" + "sort of" + "kind of" = 4
    assert _count_fillers(text) == 4


def test_count_fillers_skips_lexical_like() -> None:
    # "I like that" should *not* count — only mid-sentence "like" hedges.
    assert _count_fillers("I like the way you explained that.") == 0


def test_count_fillers_catches_hedge_like() -> None:
    assert _count_fillers("It was, like, really tough.") >= 1


def test_count_fillers_empty_string() -> None:
    assert _count_fillers("") == 0


# -----------------------------------------------------------------
# compute_voice_signals — happy path
# -----------------------------------------------------------------


def _make_turn(
    role: str,
    text: str,
    start: float,
    end: float,
    *,
    prior_end: float | None = None,
    interrupted: bool = False,
    barge_in: int = 0,
) -> VoiceTurnMetadata:
    return VoiceTurnMetadata(
        role=role,  # type: ignore[arg-type]
        transcript=text,
        audio_start_sec=start,
        audio_end_sec=end,
        prior_turn_ended_sec=prior_end,
        was_interrupted=interrupted,
        barge_in_count=barge_in,
    )


def test_compute_voice_signals_empty_returns_zeroed() -> None:
    sig = compute_voice_signals([])
    assert sig == VoiceSignals()
    assert sig.warnings == []


def test_compute_voice_signals_basic_pacing() -> None:
    # AI: 10 words in 5s → 120 wpm. User: 4 words in 2s → 120 wpm.
    turns = [
        _make_turn("ai", "one two three four five six seven eight nine ten", 0.0, 5.0),
        _make_turn("human", "this is a reply", 5.5, 7.5, prior_end=5.0),
    ]
    sig = compute_voice_signals(turns)
    assert sig.ai_avg_wpm == 120.0
    assert sig.user_avg_wpm == 120.0
    assert sig.user_avg_response_latency_sec == 0.5
    assert sig.user_max_response_latency_sec == 0.5


def test_compute_voice_signals_filler_density() -> None:
    turns = [
        _make_turn(
            "human",
            # 11 words, 1 filler ("um") → density ~9.09 per 100 words.
            "um I think the answer here is sort of complicated honestly",
            0.0,
            5.0,
        ),
    ]
    sig = compute_voice_signals(turns)
    assert sig.user_filler_count == 2  # "um" + "sort of"
    assert sig.user_filler_density_per_100w > 0


def test_compute_voice_signals_longest_silence() -> None:
    turns = [
        _make_turn("ai", "ok.", 0.0, 1.0),
        _make_turn("human", "right.", 1.5, 2.0, prior_end=1.0),
        _make_turn("ai", "go on.", 9.0, 10.0),  # 7s silence after user
    ]
    sig = compute_voice_signals(turns)
    assert sig.longest_silence_sec == 7.0


def test_compute_voice_signals_interrupts() -> None:
    turns = [
        # AI was cut off by the user (was_interrupted=True on AI side
        # is recorded as ai_interrupt_count when role=human; here we
        # encode the AI's barge_in_count instead).
        _make_turn("ai", "I was about to say something long.", 0.0, 3.0, barge_in=1),
        # User was interrupted by AI mid-utterance.
        _make_turn(
            "human",
            "I just wanted to add—",
            3.1,
            4.0,
            prior_end=3.0,
            interrupted=True,
        ),
    ]
    sig = compute_voice_signals(turns)
    assert sig.user_interrupt_count == 1  # user cut AI off
    assert sig.ai_interrupt_count == 1  # AI cut user off


def test_compute_voice_signals_speaking_time_totals() -> None:
    turns = [
        _make_turn("ai", "hi", 0.0, 2.0),
        _make_turn("human", "hello", 2.0, 3.5, prior_end=2.0),
        _make_turn("ai", "good", 3.5, 4.5),
    ]
    sig = compute_voice_signals(turns)
    assert sig.ai_speaking_time_sec == 3.0
    assert sig.user_speaking_time_sec == 1.5


# -----------------------------------------------------------------
# Robustness: dict input, malformed turns, out-of-order turns
# -----------------------------------------------------------------


def test_compute_voice_signals_accepts_dict_input() -> None:
    turns = [
        {
            "role": "human",
            "transcript": "Hi there.",
            "audio_start_sec": 0.0,
            "audio_end_sec": 1.0,
        },
    ]
    sig = compute_voice_signals(turns)
    assert sig.user_speaking_time_sec == 1.0
    assert sig.warnings == []


def test_compute_voice_signals_skips_malformed_turns() -> None:
    turns = [
        {"role": "human"},  # missing audio fields → defaults to 0/0
        "not even a dict",  # noqa: S101 — intentional bad input
    ]
    sig = compute_voice_signals(turns)  # type: ignore[arg-type]
    assert any("non-dict" in w for w in sig.warnings)


def test_compute_voice_signals_handles_unsorted_turns() -> None:
    turns = [
        _make_turn("ai", "second", 5.0, 6.0),
        _make_turn("human", "first", 1.0, 2.0),
    ]
    sig = compute_voice_signals(turns)
    # Silence gap between user (ends 2.0) and AI (starts 5.0) = 3.0s.
    assert sig.longest_silence_sec == 3.0


# -----------------------------------------------------------------
# voice_signals_to_dict
# -----------------------------------------------------------------


def test_voice_signals_to_dict_is_json_safe() -> None:
    sig = compute_voice_signals(
        [
            _make_turn("ai", "hello", 0.0, 1.0),
            _make_turn("human", "hi back", 1.0, 2.0, prior_end=1.0),
        ]
    )
    d = voice_signals_to_dict(sig)
    import json

    json.dumps(d)  # must round-trip
    assert "user_avg_wpm" in d
    assert "warnings" in d and isinstance(d["warnings"], list)
