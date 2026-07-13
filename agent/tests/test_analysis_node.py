"""Tests for `careersim_agent.graph.nodes.analysis`."""

from unittest.mock import MagicMock, patch

# `careersim_agent.services` must finish importing before
# `careersim_agent.graph` is touched: `graph/__init__.py` pulls in
# `services` transitively, and `services.conversation_service` imports
# back from `graph`. Importing `services` first here avoids tripping
# that circular import when this module is collected in isolation
# (e.g. alphabetically before the other `careersim_agent.graph.*` test
# modules that happen to import it "safely" first).
import careersim_agent.services  # noqa: F401

from careersim_agent.graph.nodes.analysis import analyze_ai_response, analyze_user_input
from careersim_agent.graph.state import create_initial_state


def _base_state(**overrides):
    state = create_initial_state(
        session_id="s-1",
        simulation={"conversationGoals": []},
        persona={"conversationStyle": {}},
    )
    state.update(overrides)
    return state


class TestAnalyzeUserInput:
    def test_skips_when_no_user_message(self):
        state = _base_state(last_user_message=None)
        result = analyze_user_input(state)
        assert "last_user_sentiment" not in result
        assert len(result["node_trace"]) == 1
        assert result["node_trace"][0]["output_summary"] == "Skipped"

    def test_returns_analysis_result_on_success(self):
        state = _base_state(last_user_message="I love this job")
        mock_service = MagicMock()
        mock_service.analyze_text.return_value = {
            "sentiment": "positive",
            "sentiment_confidence": 0.9,
            "emotion": "joy",
            "emotion_confidence": 0.8,
            "source": "eval",
        }
        with patch(
            "careersim_agent.graph.nodes.analysis.get_eval_service",
            return_value=mock_service,
        ):
            result = analyze_user_input(state)

        assert result["last_user_sentiment"] == {
            "label": "positive",
            "confidence": 0.9,
            "source": "eval",
        }
        assert result["last_user_emotion"] == {
            "label": "joy",
            "confidence": 0.8,
            "source": "eval",
        }
        assert len(result["node_trace"]) == 1
        mock_service.analyze_text.assert_called_once_with("I love this job")

    def test_falls_back_to_neutral_on_error(self):
        state = _base_state(last_user_message="whatever")
        mock_service = MagicMock()
        mock_service.analyze_text.side_effect = RuntimeError("llm down")
        with patch(
            "careersim_agent.graph.nodes.analysis.get_eval_service",
            return_value=mock_service,
        ):
            result = analyze_user_input(state)

        assert result["last_user_sentiment"] == {
            "label": "neutral",
            "confidence": 0.5,
            "source": "fallback",
        }
        assert result["last_user_emotion"] == {
            "label": "neutral",
            "confidence": 0.5,
            "source": "fallback",
        }
        assert "ERROR: llm down" in result["node_trace"][0]["output_summary"]


class TestAnalyzeAiResponse:
    def test_skips_when_no_ai_message(self):
        state = _base_state(last_ai_message=None)
        result = analyze_ai_response(state)
        assert "last_ai_sentiment" not in result
        assert result["node_trace"][0]["output_summary"] == "Skipped"

    def test_returns_analysis_result_on_success(self):
        state = _base_state(last_ai_message="Tell me more about that.")
        mock_service = MagicMock()
        mock_service.analyze_text.return_value = {
            "sentiment": "neutral",
            "sentiment_confidence": 0.6,
            "emotion": "curiosity",
            "emotion_confidence": 0.7,
            "source": "eval",
        }
        with patch(
            "careersim_agent.graph.nodes.analysis.get_eval_service",
            return_value=mock_service,
        ):
            result = analyze_ai_response(state)

        assert result["last_ai_sentiment"]["label"] == "neutral"
        assert result["last_ai_emotion"]["label"] == "curiosity"
        mock_service.analyze_text.assert_called_once_with("Tell me more about that.")

    def test_falls_back_to_neutral_on_error(self):
        state = _base_state(last_ai_message="hmm")
        mock_service = MagicMock()
        mock_service.analyze_text.side_effect = ValueError("bad json")
        with patch(
            "careersim_agent.graph.nodes.analysis.get_eval_service",
            return_value=mock_service,
        ):
            result = analyze_ai_response(state)

        assert result["last_ai_sentiment"] == {
            "label": "neutral",
            "confidence": 0.5,
            "source": "fallback",
        }
        assert "ERROR: bad json" in result["node_trace"][0]["output_summary"]
