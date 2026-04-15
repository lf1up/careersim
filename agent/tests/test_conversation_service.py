"""Tests for the ConversationService, serialisation helpers, and typing delay."""

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from careersim_agent.services.conversation_service import (
    compute_typing_delay,
    deserialize_state,
    get_typing_wpm,
    serialize_state,
    MessageEvent,
)


# =============================================================================
# Serialisation round-trip
# =============================================================================

class TestSerializeState:
    def test_messages_converted_to_role_content(self):
        state = {
            "session_id": "s1",
            "messages": [
                HumanMessage(content="Hi there"),
                AIMessage(content="Hello!"),
            ],
            "turn": "user",
        }
        wire = serialize_state(state)
        assert wire["messages"] == [
            {"role": "human", "content": "Hi there"},
            {"role": "ai", "content": "Hello!"},
        ]
        assert wire["session_id"] == "s1"
        assert wire["turn"] == "user"

    def test_empty_messages(self):
        state = {"session_id": "s1", "messages": []}
        wire = serialize_state(state)
        assert wire["messages"] == []

    def test_non_message_fields_pass_through(self):
        state = {
            "messages": [],
            "goal_progress": [{"goalNumber": 1, "status": "in_progress"}],
            "proactive_count": 3,
        }
        wire = serialize_state(state)
        assert wire["goal_progress"] == [{"goalNumber": 1, "status": "in_progress"}]
        assert wire["proactive_count"] == 3


class TestDeserializeState:
    def test_dicts_converted_to_langchain_messages(self):
        wire = {
            "session_id": "s1",
            "messages": [
                {"role": "human", "content": "Hi"},
                {"role": "ai", "content": "Hey"},
            ],
            "turn": "ai",
        }
        state = deserialize_state(wire)
        assert len(state["messages"]) == 2
        assert isinstance(state["messages"][0], HumanMessage)
        assert isinstance(state["messages"][1], AIMessage)
        assert state["messages"][0].content == "Hi"
        assert state["messages"][1].content == "Hey"
        assert state["turn"] == "ai"

    def test_unknown_roles_skipped(self):
        wire = {
            "messages": [
                {"role": "system", "content": "You are helpful"},
                {"role": "human", "content": "Hi"},
            ],
        }
        state = deserialize_state(wire)
        assert len(state["messages"]) == 1
        assert isinstance(state["messages"][0], HumanMessage)

    def test_empty_messages(self):
        wire = {"messages": []}
        state = deserialize_state(wire)
        assert state["messages"] == []

    def test_missing_messages_key(self):
        wire = {"session_id": "s1"}
        state = deserialize_state(wire)
        assert state["messages"] == []


class TestRoundTrip:
    def test_serialize_then_deserialize_preserves_content(self):
        original = {
            "session_id": "s1",
            "messages": [
                HumanMessage(content="Hello world"),
                AIMessage(content="Hi! How can I help?"),
                HumanMessage(content="Tell me about the role"),
            ],
            "goal_progress": [{"goalNumber": 1, "status": "not_started"}],
        }
        wire = serialize_state(original)
        restored = deserialize_state(wire)

        assert len(restored["messages"]) == 3
        assert isinstance(restored["messages"][0], HumanMessage)
        assert isinstance(restored["messages"][1], AIMessage)
        assert isinstance(restored["messages"][2], HumanMessage)
        assert restored["messages"][0].content == "Hello world"
        assert restored["messages"][1].content == "Hi! How can I help?"
        assert restored["goal_progress"] == original["goal_progress"]


# =============================================================================
# Typing delay
# =============================================================================

class TestComputeTypingDelay:
    def test_basic_calculation(self):
        # 60 words at 60 WPM = 60 seconds, clamped to 12
        assert compute_typing_delay("word " * 60, 60) == 12.0

    def test_short_message_clamped_to_minimum(self):
        assert compute_typing_delay("Hi", 200) == 0.5

    def test_long_message_clamped_to_maximum(self):
        assert compute_typing_delay("word " * 1000, 30) == 12.0

    def test_zero_wpm_returns_zero(self):
        assert compute_typing_delay("any text", 0) == 0.0

    def test_negative_wpm_returns_zero(self):
        assert compute_typing_delay("any text", -50) == 0.0

    def test_realistic_persona_speeds(self):
        msg = "I appreciate your answer. Let me ask you another question about your experience."
        # Brenda: 110 WPM
        delay_110 = compute_typing_delay(msg, 110)
        # Alex: 140 WPM
        delay_140 = compute_typing_delay(msg, 140)
        assert delay_110 > delay_140
        assert delay_110 >= 0.5
        assert delay_140 >= 0.5


class TestGetTypingWpm:
    def test_extracts_from_persona(self):
        state = {
            "persona": {"conversationStyle": {"typingSpeedWpm": 100}},
        }
        assert get_typing_wpm(state) == 100

    def test_fallback_when_missing(self):
        assert get_typing_wpm({}) == 120
        assert get_typing_wpm({"persona": {}}) == 120
        assert get_typing_wpm({"persona": {"conversationStyle": {}}}) == 120


# =============================================================================
# ConversationService.init_session
# =============================================================================

class TestInitSession:
    def test_creates_state_with_custom_session_id(self):
        from careersim_agent.services.conversation_service import get_conversation_service

        svc = get_conversation_service()
        state = svc.init_session("behavioral-interview-brenda", session_id="my-id-42")

        assert state["session_id"] == "my-id-42"
        assert state["persona"]["name"] == "Brenda Vance"
        assert state["simulation"]["slug"] == "behavioral-interview-brenda"
        assert len(state["goal_progress"]) > 0
        assert state["messages"] == []

    def test_generates_session_id_when_not_provided(self):
        from careersim_agent.services.conversation_service import get_conversation_service

        svc = get_conversation_service()
        state = svc.init_session("tech-cultural-interview-alex")
        assert len(state["session_id"]) == 8

    def test_invalid_slug_raises(self):
        from careersim_agent.services.conversation_service import get_conversation_service

        svc = get_conversation_service()
        with pytest.raises(ValueError, match="not found"):
            svc.init_session("nonexistent-simulation")


class TestListSimulations:
    def test_returns_all_simulations(self):
        from careersim_agent.services.conversation_service import get_conversation_service

        svc = get_conversation_service()
        sims = svc.list_simulations()
        assert len(sims) >= 7
        for s in sims:
            assert "slug" in s
            assert "title" in s
            assert "persona_name" in s

    def test_no_unknown_persona_names(self):
        from careersim_agent.services.conversation_service import get_conversation_service

        svc = get_conversation_service()
        for s in svc.list_simulations():
            assert s["persona_name"] != "Unknown", f"Simulation {s['slug']} has Unknown persona"
