"""Tests for `careersim_agent.graph.nodes.proactive`."""

from unittest.mock import MagicMock, patch

# See test_analysis_node.py for why this import must come first.
import careersim_agent.services  # noqa: F401

from langchain_core.messages import AIMessage, HumanMessage

from careersim_agent.graph.nodes.proactive import (
    _get_recent_ai_messages,
    check_proactive_trigger,
    generate_proactive_message,
)
from careersim_agent.graph.state import create_initial_state


def _base_state(**overrides):
    state = create_initial_state(
        session_id="s-1",
        simulation={"conversationGoals": []},
        persona={"conversationStyle": {}},
    )
    state.update(overrides)
    return state


class TestGetRecentAiMessages:
    def test_collects_most_recent_ai_messages_first(self):
        messages = [
            AIMessage(content="first"),
            HumanMessage(content="human"),
            AIMessage(content="second"),
            AIMessage(content="third"),
        ]
        result = _get_recent_ai_messages({"messages": messages}, count=2)
        assert result == ["third", "second"]

    def test_returns_empty_list_when_no_messages(self):
        assert _get_recent_ai_messages({"messages": []}) == []


class TestCheckProactiveTrigger:
    def test_no_trigger_and_no_burstiness_configured(self):
        state = _base_state(proactive_trigger=None)
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is False

    def test_no_trigger_with_burstiness_forces_followup(self):
        state = _base_state(
            proactive_trigger=None,
            proactive_count=0,
            persona={
                "conversationStyle": {
                    "burstiness": {"min": 1, "max": 3},
                },
            },
        )
        with patch("careersim_agent.graph.nodes.proactive.random.random", return_value=0.0):
            with patch(
                "careersim_agent.graph.nodes.proactive.random.randint", return_value=2,
            ):
                result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is True
        assert result["proactive_trigger"] == "followup"
        assert result["max_proactive_messages"] == 2

    def test_no_trigger_with_burstiness_but_low_probability_roll(self):
        state = _base_state(
            proactive_trigger=None,
            proactive_count=0,
            persona={
                "conversationStyle": {
                    "burstiness": {"min": 1, "max": 3},
                },
            },
        )
        with patch("careersim_agent.graph.nodes.proactive.random.random", return_value=0.99):
            result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is False

    def test_start_trigger_respects_starts_conversation_true(self):
        state = _base_state(
            proactive_trigger="start",
            persona={"conversationStyle": {"startsConversation": True}},
        )
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is True
        assert result["max_proactive_messages"] == 1

    def test_start_trigger_respects_starts_conversation_false(self):
        state = _base_state(
            proactive_trigger="start",
            persona={"conversationStyle": {"startsConversation": False}},
        )
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is False

    def test_inactivity_trigger_with_no_nudges_configured(self):
        state = _base_state(
            proactive_trigger="inactivity",
            persona={"conversationStyle": {}},
        )
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is False

    def test_inactivity_trigger_under_nudge_limit(self):
        state = _base_state(
            proactive_trigger="inactivity",
            proactive_count=0,
            persona={"conversationStyle": {"inactivityNudges": {"max": 2}}},
        )
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is True
        assert result["max_proactive_messages"] == 2

    def test_inactivity_trigger_at_nudge_limit(self):
        state = _base_state(
            proactive_trigger="inactivity",
            proactive_count=2,
            persona={"conversationStyle": {"inactivityNudges": {"max": 2}}},
        )
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is False

    def test_followup_trigger_under_max(self):
        state = _base_state(
            proactive_trigger="followup",
            proactive_count=1,
            max_proactive_messages=3,
        )
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is True

    def test_followup_trigger_at_max(self):
        state = _base_state(
            proactive_trigger="followup",
            proactive_count=3,
            max_proactive_messages=3,
        )
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is False

    def test_unknown_trigger_does_nothing(self):
        state = _base_state(proactive_trigger="mystery")
        result = check_proactive_trigger(state)
        assert result["should_send_proactive"] is False


class TestGenerateProactiveMessage:
    def _mock_chat_openai(self, content="Hey, how's it going?"):
        mock_model = MagicMock()
        mock_model.invoke.return_value = MagicMock(content=content)
        mock_cls = MagicMock(return_value=mock_model)
        return mock_cls, mock_model

    def test_generates_start_message_and_analysis(self):
        state = _base_state(proactive_trigger="start")
        mock_cls, mock_model = self._mock_chat_openai()
        mock_eval_service = MagicMock()
        mock_eval_service.analyze_text.return_value = {
            "sentiment": "positive",
            "sentiment_confidence": 0.9,
            "emotion": "joy",
            "emotion_confidence": 0.8,
            "source": "eval",
        }
        with patch("careersim_agent.graph.nodes.proactive.ChatOpenAI", mock_cls), patch(
            "careersim_agent.graph.nodes.proactive.get_eval_service",
            return_value=mock_eval_service,
        ):
            result = generate_proactive_message(state)

        assert result["last_ai_message"] == "Hey, how's it going?"
        assert result["turn"] == "user"
        assert result["proactive_count"] == 1
        assert result["message_count"] == 1
        assert len(result["messages"]) == 1
        assert result["last_ai_sentiment"]["label"] == "positive"
        mock_model.invoke.assert_called_once()

    def test_generates_inactivity_message(self):
        state = _base_state(
            proactive_trigger="inactivity",
            last_user_message="hello?",
            last_ai_message="hi there",
        )
        mock_cls, _ = self._mock_chat_openai("Still there?")
        with patch("careersim_agent.graph.nodes.proactive.ChatOpenAI", mock_cls), patch(
            "careersim_agent.graph.nodes.proactive.get_eval_service",
            side_effect=RuntimeError("eval down"),
        ):
            result = generate_proactive_message(state)

        # eval_service failure falls back to a neutral analysis instead of failing the node
        assert result["last_ai_message"] == "Still there?"
        assert result["last_ai_sentiment"]["label"] == "neutral"
        assert result["last_ai_sentiment"]["source"] == "fallback"

    def test_generates_followup_message_by_default_trigger(self):
        state = _base_state(proactive_trigger=None)
        mock_cls, _ = self._mock_chat_openai("One more thing...")
        mock_eval_service = MagicMock()
        mock_eval_service.analyze_text.return_value = {
            "sentiment": "neutral",
            "sentiment_confidence": 0.5,
            "emotion": "neutral",
            "emotion_confidence": 0.5,
            "source": "eval",
        }
        with patch("careersim_agent.graph.nodes.proactive.ChatOpenAI", mock_cls), patch(
            "careersim_agent.graph.nodes.proactive.get_eval_service",
            return_value=mock_eval_service,
        ):
            result = generate_proactive_message(state)
        assert result["last_ai_message"] == "One more thing..."

    def test_raises_are_caught_and_reported_as_error(self):
        state = _base_state(proactive_trigger="start")
        mock_cls, mock_model = self._mock_chat_openai()
        mock_model.invoke.side_effect = RuntimeError("model unreachable")
        with patch("careersim_agent.graph.nodes.proactive.ChatOpenAI", mock_cls):
            result = generate_proactive_message(state)

        assert result["should_send_proactive"] is False
        assert result["proactive_trigger"] is None
        assert "model unreachable" in result["last_error"]

    def test_empty_generated_content_is_treated_as_an_error(self):
        state = _base_state(proactive_trigger="start")
        mock_cls, _ = self._mock_chat_openai(content="   ")
        with patch("careersim_agent.graph.nodes.proactive.ChatOpenAI", mock_cls):
            result = generate_proactive_message(state)

        assert result["should_send_proactive"] is False
        assert "Empty proactive message generated" in result["last_error"]
