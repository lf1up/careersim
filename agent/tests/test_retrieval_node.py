"""Tests for `careersim_agent.graph.nodes.retrieval`."""

from unittest.mock import MagicMock, patch

# See test_analysis_node.py for why this import must come first.
import careersim_agent.services  # noqa: F401

from careersim_agent.graph.nodes.retrieval import retrieve_context
from careersim_agent.graph.state import create_initial_state


def _base_state(**overrides):
    state = create_initial_state(
        session_id="s-1",
        simulation={"conversationGoals": [], "slug": "sim-1"},
        persona={"conversationStyle": {}, "slug": "persona-1"},
    )
    state.update(overrides)
    return state


def _mock_settings(rag_enabled=True):
    settings = MagicMock()
    settings.rag_enabled = rag_enabled
    return settings


class TestRetrieveContext:
    def test_skips_when_rag_disabled(self):
        state = _base_state(last_user_message="tell me about the role")
        with patch(
            "careersim_agent.graph.nodes.retrieval.get_settings",
            return_value=_mock_settings(rag_enabled=False),
        ):
            result = retrieve_context(state)
        assert result == {
            "retrieved_context": None,
            "node_trace": result["node_trace"],
        }
        assert result["node_trace"][0]["output_summary"] == "skipped"

    def test_skips_when_no_user_message(self):
        state = _base_state(last_user_message=None)
        with patch(
            "careersim_agent.graph.nodes.retrieval.get_settings",
            return_value=_mock_settings(rag_enabled=True),
        ):
            result = retrieve_context(state)
        assert result["retrieved_context"] is None

    def test_returns_formatted_context_on_success(self):
        state = _base_state(last_user_message="what does the role involve?")
        mock_service = MagicMock()
        mock_docs = [MagicMock(), MagicMock()]
        mock_service.retrieve.return_value = mock_docs
        mock_service.format_context.return_value = "chunk 1\n\nchunk 2"

        with patch(
            "careersim_agent.graph.nodes.retrieval.get_settings",
            return_value=_mock_settings(rag_enabled=True),
        ), patch(
            "careersim_agent.services.retrieval_service.get_retrieval_service",
            return_value=mock_service,
        ):
            result = retrieve_context(state)

        assert result["retrieved_context"] == "chunk 1\n\nchunk 2"
        mock_service.retrieve.assert_called_once_with(
            query="what does the role involve?",
            simulation_slug="sim-1",
            persona_slug="persona-1",
        )
        assert "2 chunks retrieved" in result["node_trace"][0]["output_summary"]

    def test_returns_none_when_no_documents_found(self):
        state = _base_state(last_user_message="anything relevant?")
        mock_service = MagicMock()
        mock_service.retrieve.return_value = []
        mock_service.format_context.return_value = ""

        with patch(
            "careersim_agent.graph.nodes.retrieval.get_settings",
            return_value=_mock_settings(rag_enabled=True),
        ), patch(
            "careersim_agent.services.retrieval_service.get_retrieval_service",
            return_value=mock_service,
        ):
            result = retrieve_context(state)

        assert result["retrieved_context"] is None
        assert "no relevant documents found" in result["node_trace"][0]["output_summary"]

    def test_returns_none_and_traces_error_when_retrieval_raises(self):
        state = _base_state(last_user_message="anything relevant?")
        mock_service = MagicMock()
        mock_service.retrieve.side_effect = RuntimeError("chroma unavailable")

        with patch(
            "careersim_agent.graph.nodes.retrieval.get_settings",
            return_value=_mock_settings(rag_enabled=True),
        ), patch(
            "careersim_agent.services.retrieval_service.get_retrieval_service",
            return_value=mock_service,
        ):
            result = retrieve_context(state)

        assert result["retrieved_context"] is None
        assert "ERROR" in result["node_trace"][0]["output_summary"]
        assert "chroma unavailable" in result["node_trace"][0]["output_summary"]
