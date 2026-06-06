"""Tests for :class:`LangGraphAdapter` and the chunk helper.

The adapter is exercised against a fake :class:`ConversationService`
that records calls and returns canned states; we don't run the real
graph here (that path is already covered by `test_graph.py`).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from careersim_agent.services.eval_service import VoiceTurnMetadata
from careersim_agent.voice.pipeline import LangGraphAdapter, stream_chunks


@dataclass
class FakeConversationService:
    """In-memory ConversationService stand-in for adapter tests.

    Each call to ``invoke_turn`` / ``invoke_proactive`` appends the
    provided AI reply to the state's messages and returns it. Tests
    can pin the next reply by setting ``next_ai_reply``.
    """
    next_ai_reply: str = "Sure, happy to help!"
    invoked_turns: list[str] = field(default_factory=list)
    invoked_proactives: list[str] = field(default_factory=list)
    delay_sec: float = 0.0

    def invoke_turn(self, state: dict[str, Any], user_message: str) -> dict[str, Any]:
        if self.delay_sec:
            import time
            time.sleep(self.delay_sec)
        self.invoked_turns.append(user_message)
        out = dict(state)
        out["messages"] = list(state.get("messages") or []) + [
            HumanMessage(content=user_message),
            AIMessage(content=self.next_ai_reply),
        ]
        return out

    def invoke_proactive(self, state: dict[str, Any], trigger: str) -> dict[str, Any]:
        self.invoked_proactives.append(trigger)
        out = dict(state)
        out["messages"] = list(state.get("messages") or []) + [
            AIMessage(content=f"Hey! Thanks for taking the call. ({trigger})"),
        ]
        return out


def _wire_state(*, starts: bool = False) -> dict[str, Any]:
    """Build a minimal wire-format state for adapter tests."""
    return {
        "session_id": "sess-test",
        "messages": [],
        "persona": {"slug": "vikram", "name": "Vikram"},
        "proactive_trigger": "start" if starts else None,
        "proactive_count": 0,
    }


# -----------------------------------------------------------------
# Single-turn happy path
# -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_user_turn_appends_ai_reply() -> None:
    svc = FakeConversationService(next_ai_reply="Got it — let me check.")
    adapter = LangGraphAdapter(_wire_state(), service=svc)

    result = await adapter.user_turn("hi there")

    assert result.text == "Got it — let me check."
    assert result.burst_messages == ["Got it — let me check."]
    assert svc.invoked_turns == ["hi there"]
    assert adapter.session_id == "sess-test"


@pytest.mark.asyncio
async def test_user_turn_serialises_state_through_wire_format() -> None:
    svc = FakeConversationService(next_ai_reply="Reply!")
    adapter = LangGraphAdapter(_wire_state(), service=svc)

    result = await adapter.user_turn("hello")

    msgs = result.new_state["messages"]
    assert len(msgs) == 2
    assert msgs[0] == {"role": "human", "content": "hello"}
    assert msgs[1] == {"role": "ai", "content": "Reply!"}


# -----------------------------------------------------------------
# Burst messages collapse into a single spoken reply
# -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_burst_messages_are_joined_with_pause_marker() -> None:
    class BurstService(FakeConversationService):
        def invoke_turn(self, state, user_message):
            self.invoked_turns.append(user_message)
            out = dict(state)
            out["messages"] = list(state.get("messages") or []) + [
                HumanMessage(content=user_message),
                AIMessage(content="oh hi!"),
                AIMessage(content="how can I help today?"),
            ]
            return out

    adapter = LangGraphAdapter(_wire_state(), service=BurstService())
    result = await adapter.user_turn("hey")

    assert result.burst_messages == ["oh hi!", "how can I help today?"]
    assert result.text == "oh hi! … how can I help today?"


# -----------------------------------------------------------------
# Opening turn
# -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_opening_turn_runs_when_persona_starts() -> None:
    svc = FakeConversationService()
    adapter = LangGraphAdapter(_wire_state(starts=True), service=svc)

    result = await adapter.opening_turn()
    assert result is not None
    assert "Thanks for taking the call" in result.text
    assert svc.invoked_proactives == ["start"]


@pytest.mark.asyncio
async def test_opening_turn_returns_none_when_persona_doesnt_start() -> None:
    svc = FakeConversationService()
    adapter = LangGraphAdapter(_wire_state(starts=False), service=svc)

    result = await adapter.opening_turn()
    assert result is None
    assert svc.invoked_proactives == []


# -----------------------------------------------------------------
# Cancellation / barge-in
# -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_cancel_inflight_aborts_running_turn() -> None:
    # Introduce a 200 ms sync delay so the turn is genuinely in-flight
    # when we cancel it.
    svc = FakeConversationService(delay_sec=0.2)
    adapter = LangGraphAdapter(_wire_state(), service=svc)

    task = asyncio.create_task(adapter.user_turn("slow request"))
    # Yield once so the executor schedules the work, then cancel.
    await asyncio.sleep(0.05)
    await adapter.cancel_inflight()

    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_cancel_inflight_safe_when_idle() -> None:
    svc = FakeConversationService()
    adapter = LangGraphAdapter(_wire_state(), service=svc)
    # Should not raise.
    await adapter.cancel_inflight()
    await adapter.cancel_inflight()


# -----------------------------------------------------------------
# State + persona getters
# -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_persona_getter_returns_copy() -> None:
    svc = FakeConversationService()
    adapter = LangGraphAdapter(_wire_state(), service=svc)
    p = adapter.persona
    p["mutated"] = True
    assert "mutated" not in adapter.persona


# -----------------------------------------------------------------
# stream_chunks
# -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_stream_chunks_splits_on_sentence_boundaries() -> None:
    text = "Hi there! How are you doing today? Let me check on that."
    out = [c async for c in stream_chunks(text)]
    assert out == [
        "Hi there!",
        "How are you doing today?",
        "Let me check on that.",
    ]


@pytest.mark.asyncio
async def test_stream_chunks_falls_back_to_word_windows() -> None:
    long_sentence = (
        "this single sentence is intentionally a bit long so the chunker "
        "has to fall back to fixed word windows but each emitted chunk "
        "still ends on a clean word boundary which matters for piper"
    )
    chunks = [c async for c in stream_chunks(long_sentence, chunker_size=60)]
    assert len(chunks) >= 2
    # Re-joining must reconstruct the original sentence (modulo whitespace).
    assert " ".join(chunks).replace("  ", " ") == long_sentence


@pytest.mark.asyncio
async def test_stream_chunks_empty_input() -> None:
    out = [c async for c in stream_chunks("")]
    assert out == []
    out = [c async for c in stream_chunks("   ")]
    assert out == []


# -----------------------------------------------------------------
# Voice turn metadata + finalize_voice_analysis
# -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_finalize_voice_analysis_merges_signals_into_state() -> None:
    svc = FakeConversationService()
    adapter = LangGraphAdapter(_wire_state(), service=svc)

    adapter.record_voice_turn(
        VoiceTurnMetadata(
            role="ai",
            transcript="Hi there, how are you doing today?",
            audio_start_sec=0.0,
            audio_end_sec=2.0,
        )
    )
    adapter.record_voice_turn(
        VoiceTurnMetadata(
            role="human",
            transcript="Um, I'm doing fine, thanks.",
            audio_start_sec=2.5,
            audio_end_sec=4.0,
            prior_turn_ended_sec=2.0,
        )
    )
    adapter.record_voice_turn(
        VoiceTurnMetadata(
            role="ai",
            transcript="Great. Tell me about your last project.",
            audio_start_sec=4.5,
            audio_end_sec=6.5,
            barge_in_count=1,
        )
    )

    analysis = adapter.finalize_voice_analysis()
    assert "voice" in analysis
    voice = analysis["voice"]
    assert voice["user_filler_count"] >= 1
    assert voice["user_interrupt_count"] == 1
    assert voice["user_avg_response_latency_sec"] == 0.5
    assert len(voice["turns"]) == 3
    assert voice["turns"][0]["role"] == "ai"
    assert voice["turns"][1]["role"] == "human"
    # The state on the adapter should also carry the merged analysis.
    assert adapter.current_state_wire().get("analysis", {}).get("voice")
