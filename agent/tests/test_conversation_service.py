"""Tests for the ConversationService, serialisation helpers, and typing delay."""

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from careersim_agent.services.conversation_service import (
    ConversationService,
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


# =============================================================================
# Streaming delta
#
# Regression guard for the bug where `_stream_graph` yielded one MessageEvent
# per message in the node output (which is the *full* conversation history by
# convention in this codebase) instead of only the newly-appended tail. That
# caused every streamed turn to re-emit every prior AI message.
# =============================================================================


def _make_ai_message(content: str) -> AIMessage:
    return AIMessage(content=content)


class _FakeGraph:
    """Mimics just enough of langgraph's StateGraph to drive `_stream_graph`.

    Each scripted step is a pair `(node_name, updates)` where ``updates`` is
    the dict the node returned. Matching the real nodes in this codebase, the
    ``messages`` value is the *full* conversation list — not a delta.
    """

    def __init__(self, steps: list[tuple[str, dict]]):
        self._steps = steps

    def stream(self, state, stream_mode: str = "updates"):
        assert stream_mode == "updates"
        for node, updates in self._steps:
            yield {node: updates}


class TestStreamGraphDelta:
    def _make_service(self, steps: list[tuple[str, dict]]) -> ConversationService:
        svc = ConversationService.__new__(ConversationService)
        svc._graph = _FakeGraph(steps)  # type: ignore[attr-defined]
        return svc

    def test_yields_only_newly_appended_messages(self):
        prior = [AIMessage(content="Opening line.")]
        state = {
            "messages": list(prior),
            "persona": {"conversationStyle": {"typingSpeedWpm": 120}},
        }

        new_ai = _make_ai_message("Response to user.")
        steps = [
            ("process_user_input", {"last_user_message": "hi"}),
            ("analyze_user_input", {"user_intent": "greet"}),
            ("retrieve_context", {"retrieved_context": []}),
            (
                "generate_response",
                {
                    # Full history by convention — must NOT be re-emitted.
                    "messages": prior + [new_ai],
                    "last_ai_message": new_ai.content,
                },
            ),
        ]
        svc = self._make_service(steps)

        events = [e for e in svc._stream_graph(state) if not e.is_final]

        assert len(events) == 1, f"expected 1 new message, got {[e.content for e in events]}"
        assert events[0].content == "Response to user."
        assert events[0].node == "generate_response"
        assert events[0].is_followup is False

    def test_yields_tail_across_response_and_followup_bursts(self):
        prior = [AIMessage(content="Opening line.")]
        state = {
            "messages": list(prior),
            "persona": {"conversationStyle": {"typingSpeedWpm": 120}},
        }

        reply = _make_ai_message("Direct reply.")
        followup_1 = _make_ai_message("One more thought.")
        followup_2 = _make_ai_message("And another.")

        steps = [
            ("generate_response", {"messages": prior + [reply]}),
            ("analyze_response", {"last_ai_sentiment": "neutral"}),
            ("evaluate_goals", {"goal_progress": []}),
            ("check_proactive", {"should_send_proactive": True}),
            (
                "generate_proactive",
                {"messages": prior + [reply, followup_1]},
            ),
            ("check_proactive", {"should_send_proactive": True}),
            (
                "generate_proactive",
                {"messages": prior + [reply, followup_1, followup_2]},
            ),
        ]
        svc = self._make_service(steps)

        events = [e for e in svc._stream_graph(state) if not e.is_final]

        assert [e.content for e in events] == [
            "Direct reply.",
            "One more thought.",
            "And another.",
        ]
        assert [e.is_followup for e in events] == [False, True, True]
        assert [e.message_index for e in events] == [0, 1, 2]

    def test_first_event_has_zero_typing_delay(self):
        new_ai = _make_ai_message("Hello there my friend how are you today.")
        steps = [("generate_response", {"messages": [new_ai]})]
        svc = self._make_service(steps)

        events = [e for e in svc._stream_graph({"messages": []}) if not e.is_final]

        assert len(events) == 1
        assert events[0].typing_delay_sec == 0.0

    def test_non_message_nodes_do_not_yield_events(self):
        state = {"messages": [AIMessage(content="prev")]}
        steps = [
            ("evaluate_goals", {"goal_progress": [{"goalNumber": 1}]}),
            ("analyze_response", {"last_ai_sentiment": "positive"}),
        ]
        svc = self._make_service(steps)

        events = [e for e in svc._stream_graph(state) if not e.is_final]
        assert events == []

    def test_final_event_carries_latest_state_snapshot(self):
        prior = [AIMessage(content="a")]
        new_ai = _make_ai_message("b")
        steps = [
            ("generate_response", {"messages": prior + [new_ai]}),
            ("evaluate_goals", {"goal_progress": [{"goalNumber": 3}]}),
        ]
        svc = self._make_service(steps)

        events = list(svc._stream_graph({"messages": list(prior)}))

        assert events[-1].is_final is True
        final_state = events[-1].state
        assert [m.content for m in final_state["messages"]] == ["a", "b"]
        assert final_state["goal_progress"] == [{"goalNumber": 3}]
