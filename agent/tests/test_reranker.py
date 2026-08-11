"""Tests for the RAG retrieval hardening: frontmatter metadata,
`where` filter construction, and the fail-open cross-encoder reranker
(mitigations for the single-vector limits in arXiv:2508.21038)."""

from unittest.mock import MagicMock, patch

# See test_analysis_node.py for why this import must come first.
import careersim_agent.services  # noqa: F401

from careersim_agent.services.reranker import Reranker, reset_reranker
from careersim_agent.services.retrieval_service import (
    _build_where_filter,
    _split_frontmatter,
)


class TestSplitFrontmatter:
    def test_no_frontmatter_returns_text_unchanged(self):
        text = "# Hello\n\nJust a body."
        tags, body = _split_frontmatter(text)
        assert tags == []
        assert body == text

    def test_extracts_tags_and_strips_block(self):
        text = (
            "---\n"
            "tags: [money, Negotiation, 'feedback']\n"
            "---\n"
            "# Actual content\n"
            "\n"
            "Body here.\n"
        )
        tags, body = _split_frontmatter(text)
        assert tags == ["money", "negotiation", "feedback"]
        assert "---" not in body
        assert "# Actual content" in body
        assert "tags:" not in body

    def test_frontmatter_without_tags(self):
        text = "---\ntitle: Something\n---\nBody."
        tags, body = _split_frontmatter(text)
        assert tags == []
        assert body == "Body."

    def test_empty_tags_list(self):
        text = "---\ntags: []\n---\nBody."
        tags, body = _split_frontmatter(text)
        assert tags == []
        assert body == "Body."


class TestBuildWhereFilter:
    def test_no_constraints_returns_none(self):
        assert _build_where_filter() is None
        assert _build_where_filter(doc_types=[], tags=[]) is None

    def test_doc_types_only(self):
        assert _build_where_filter(doc_types=["persona", "shared"]) == {
            "doc_type": {"$in": ["persona", "shared"]}
        }

    def test_single_tag_only(self):
        assert _build_where_filter(tags=["Money"]) == {
            "tags": {"$contains": "money"}
        }

    def test_doc_types_and_multiple_tags_are_anded(self):
        where = _build_where_filter(doc_types=["persona"], tags=["money", "negotiation"])
        assert where == {
            "$and": [
                {"doc_type": {"$in": ["persona"]}},
                {"tags": {"$contains": "money"}},
                {"tags": {"$contains": "negotiation"}},
            ]
        }


class TestReranker:
    def setup_method(self):
        reset_reranker()

    def test_scores_pairs_via_cross_encoder(self):
        fake_model = MagicMock()
        fake_model.predict.return_value = [0.1, 0.9]
        fake_ce_cls = MagicMock(return_value=fake_model)

        with patch.dict(
            "sys.modules",
            {"sentence_transformers": MagicMock(CrossEncoder=fake_ce_cls)},
        ):
            r = Reranker("fake-model")
            scores = r.score("q", ["doc a", "doc b"])

        assert scores == [0.1, 0.9]
        fake_ce_cls.assert_called_once_with("fake-model")
        fake_model.predict.assert_called_once_with([("q", "doc a"), ("q", "doc b")])

    def test_empty_texts_returns_empty_without_loading(self):
        r = Reranker("fake-model")
        assert r.score("q", []) == []
        assert r._model is None

    def test_load_failure_disables_and_returns_none(self):
        fake_ce_cls = MagicMock(side_effect=ImportError("no torch"))

        with patch.dict(
            "sys.modules",
            {"sentence_transformers": MagicMock(CrossEncoder=fake_ce_cls)},
        ):
            r = Reranker("missing-model")
            assert r.score("q", ["doc"]) is None
            # Disabled permanently — subsequent calls don't retry the load
            assert r.score("q", ["doc"]) is None
            assert fake_ce_cls.call_count == 1

    def test_inference_failure_disables_and_returns_none(self):
        fake_model = MagicMock()
        fake_model.predict.side_effect = RuntimeError("boom")
        fake_ce_cls = MagicMock(return_value=fake_model)

        with patch.dict(
            "sys.modules",
            {"sentence_transformers": MagicMock(CrossEncoder=fake_ce_cls)},
        ):
            r = Reranker("fake-model")
            assert r.score("q", ["doc"]) is None
            assert r._disabled is True
