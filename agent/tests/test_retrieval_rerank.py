"""Tests for RetrievalService.retrieve() rerank + filter plumbing.

The Chroma stores are mocked; these tests verify wiring: filters are
passed through, the candidate pool widens when reranking is enabled, the
final order follows cross-encoder scores, and failures fall back to
vector order.
"""

from unittest.mock import MagicMock, patch

from langchain_core.documents import Document

# See test_analysis_node.py for why this import must come first.
import careersim_agent.services  # noqa: F401

from careersim_agent.services import retrieval_service as rs


def _make_service(rerank_enabled: bool, multiplier: int = 3):
    """Returns (service, settings) with embeddings/chroma mocked out."""
    settings = MagicMock()
    settings.rag_embedding_model = "fake"
    settings.openai_api_key = "sk-fake"
    settings.openai_base_url = None
    settings.openai_default_headers = None
    settings.rag_chunk_size = 800
    settings.rag_chunk_overlap = 100
    settings.rag_top_k = 2
    settings.rag_chroma_persist_dir = ".chroma_test"
    settings.rag_rerank_enabled = rerank_enabled
    settings.rag_rerank_model = "fake-cross-encoder"
    settings.rag_rerank_candidates_multiplier = multiplier

    with patch.object(rs, "get_settings", return_value=settings), patch(
        "careersim_agent.services.retrieval_service.OpenAIEmbeddings"
    ), patch("careersim_agent.services.retrieval_service.chromadb"):
        service = rs.RetrievalService()
    return service, settings


def _stub_collections(service: rs.RetrievalService, search_results: dict):
    """Make every collection non-empty and return canned per-collection hits."""
    fake_col = MagicMock()
    fake_col.count.return_value = 5
    service._client.get_collection.return_value = fake_col

    def fake_search(self, query, k=None, filter=None):
        # Return docs based on the collection name this store was built with
        return search_results[self.collection_name]

    stores = []

    class FakeChroma:
        def __init__(self, client=None, collection_name=None, embedding_function=None):
            self.collection_name = collection_name
            stores.append(self)

        def similarity_search_with_relevance_scores(self, query, k=None, filter=None):
            self.last_filter = filter
            self.last_k = k
            return search_results.get(self.collection_name, [])

    return FakeChroma, stores


def _doc(text: str, score_hash: "str | None" = None) -> Document:
    return Document(
        page_content=text,
        metadata={"content_hash": score_hash or text},
    )


class TestRetrieveRerank:
    def test_rerank_disabled_keeps_vector_order_and_top_k(self):
        service, settings = _make_service(rerank_enabled=False)
        results = {
            "sim--sim-1": [(_doc("a"), 0.9), (_doc("b"), 0.8), (_doc("c"), 0.7)],
            "persona--p-1": [(_doc("d"), 0.85)],
            "shared": [(_doc("e"), 0.6)],
        }
        FakeChroma, stores = _stub_collections(service, results)

        with patch.object(rs, "get_settings", return_value=settings), patch(
            "careersim_agent.services.retrieval_service.Chroma", FakeChroma
        ):
            docs = service.retrieve("q", "sim-1", "p-1")

        assert [d.page_content for d in docs] == ["a", "d"]  # vector order, k=2
        assert all(s.last_filter is None for s in stores)

    def test_filters_passed_to_chroma(self):
        service, settings = _make_service(rerank_enabled=False)
        FakeChroma, stores = _stub_collections(service, {})

        with patch.object(rs, "get_settings", return_value=settings), patch(
            "careersim_agent.services.retrieval_service.Chroma", FakeChroma
        ):
            service.retrieve("q", "sim-1", "p-1", doc_types=["persona"], tags=["money"])

        expected = {
            "$and": [
                {"doc_type": {"$in": ["persona"]}},
                {"tags": {"$contains": "money"}},
            ]
        }
        assert stores  # at least one collection searched
        assert all(s.last_filter == expected for s in stores)

    def test_rerank_reorders_and_widens_candidate_pool(self):
        service, settings = _make_service(rerank_enabled=True, multiplier=3)
        # k=2, multiplier=3 → candidate pool of 6, per-collection k=6
        docs = [(_doc(f"doc{i}"), 1.0 - i * 0.1) for i in range(6)]
        results = {"sim--sim-1": docs, "persona--p-1": [], "shared": []}
        FakeChroma, stores = _stub_collections(service, results)

        # Cross-encoder reverses the vector order: doc0 worst … doc5 best
        reranker = MagicMock()
        reranker.score.return_value = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]

        with patch.object(rs, "get_settings", return_value=settings), patch(
            "careersim_agent.services.retrieval_service.Chroma", FakeChroma
        ), patch(
            "careersim_agent.services.reranker.get_reranker", return_value=reranker
        ):
            out = service.retrieve("q", "sim-1", "p-1")

        assert [d.page_content for d in out] == ["doc5", "doc4"]
        assert stores[0].last_k == 6  # widened candidate pool

    def test_rerank_failure_falls_back_to_vector_order(self):
        service, settings = _make_service(rerank_enabled=True)
        docs = [(_doc("x"), 0.9), (_doc("y"), 0.8)]
        results = {"sim--sim-1": docs, "persona--p-1": [], "shared": []}
        FakeChroma, _stores = _stub_collections(service, results)

        reranker = MagicMock()
        reranker.score.return_value = None  # fail-open path

        with patch.object(rs, "get_settings", return_value=settings), patch(
            "careersim_agent.services.retrieval_service.Chroma", FakeChroma
        ), patch(
            "careersim_agent.services.reranker.get_reranker", return_value=reranker
        ):
            out = service.retrieve("q", "sim-1", "p-1")

        assert [d.page_content for d in out] == ["x", "y"]

    def test_rerank_exception_falls_back_to_vector_order(self):
        service, settings = _make_service(rerank_enabled=True)
        docs = [(_doc("x"), 0.9), (_doc("y"), 0.8)]
        results = {"sim--sim-1": docs, "persona--p-1": [], "shared": []}
        FakeChroma, _stores = _stub_collections(service, results)

        with patch.object(rs, "get_settings", return_value=settings), patch(
            "careersim_agent.services.retrieval_service.Chroma", FakeChroma
        ), patch(
            "careersim_agent.services.reranker.get_reranker",
            side_effect=RuntimeError("no model"),
        ):
            out = service.retrieve("q", "sim-1", "p-1")

        assert [d.page_content for d in out] == ["x", "y"]

    def test_skips_empty_missing_and_failing_collections(self):
        service, settings = _make_service(rerank_enabled=False)

        def get_collection(name):
            if name.startswith("sim--"):
                col = MagicMock()
                col.count.return_value = 0
                return col
            if name.startswith("persona--"):
                raise RuntimeError("no such collection")
            col = MagicMock()
            col.count.return_value = 2
            return col

        service._client.get_collection.side_effect = get_collection

        class FakeChroma:
            def __init__(self, client=None, collection_name=None, embedding_function=None):
                self.collection_name = collection_name

            def similarity_search_with_relevance_scores(self, query, k=None, filter=None):
                raise RuntimeError("search down")

        with patch.object(rs, "get_settings", return_value=settings), patch(
            "careersim_agent.services.retrieval_service.Chroma", FakeChroma
        ):
            assert service.retrieve("q", "sim-1", "p-1") == []

    def test_duplicate_chunks_are_dropped(self):
        service, settings = _make_service(rerank_enabled=False)
        results = {
            "sim--sim-1": [(_doc("first", "same"), 0.9), (_doc("second", "same"), 0.8)],
            "persona--p-1": [],
            "shared": [],
        }
        FakeChroma, _stores = _stub_collections(service, results)

        with patch.object(rs, "get_settings", return_value=settings), patch(
            "careersim_agent.services.retrieval_service.Chroma", FakeChroma
        ):
            docs = service.retrieve("q", "sim-1", "p-1")

        assert [d.page_content for d in docs] == ["first"]


class TestIndexingAndFormatting:
    def test_absolute_persist_dir_is_not_rewritten(self):
        settings = MagicMock()
        settings.rag_embedding_model = "fake"
        settings.openai_api_key = "sk-fake"
        settings.openai_base_url = "https://example.test/v1"
        settings.openai_default_headers = {"X-Title": "CareerSIM"}
        settings.rag_chunk_size = 800
        settings.rag_chunk_overlap = 100
        settings.rag_top_k = 2
        settings.rag_chroma_persist_dir = "/tmp/chroma-abs"

        with patch.object(rs, "get_settings", return_value=settings), patch(
            "careersim_agent.services.retrieval_service.OpenAIEmbeddings"
        ) as embeddings, patch("careersim_agent.services.retrieval_service.chromadb"):
            service = rs.RetrievalService()

        assert service._persist_dir.as_posix() == "/tmp/chroma-abs"
        kwargs = embeddings.call_args.kwargs
        assert kwargs["base_url"] == "https://example.test/v1"
        assert kwargs["default_headers"] == {"X-Title": "CareerSIM"}

    def test_no_chunks_and_no_doc_type_index_nothing(self, tmp_path):
        service, _settings = _make_service(rerank_enabled=False)
        (tmp_path / "note.md").write_text("Hello.\n")
        service._splitter.split_documents = lambda docs: []

        assert service._ensure_collection_indexed("sim--x", tmp_path) is None

    def test_reloads_hashes_when_the_memory_cache_misses_them(self, tmp_path):
        service, _settings = _make_service(rerank_enabled=False)
        (tmp_path / "note.md").write_text("Hello from the doc.\n")
        service._splitter.split_documents = lambda docs: docs
        content_hash = rs._file_content_hash("Hello from the doc.\n")

        class _Ghost(dict):
            """Hashes look known, but the collection key was never stored."""

            def get(self, key, default=None):
                return {content_hash}

            def __contains__(self, key):
                return False

        service._indexed_hashes = _Ghost()
        stored = MagicMock()
        stored.get.return_value = {
            "metadatas": [{"content_hash": content_hash}, None, {"source": "note.md"}],
        }
        service._client.get_collection.side_effect = [stored, RuntimeError("missing")]

        class FakeChroma:
            def __init__(self, client=None, collection_name=None, embedding_function=None):
                pass

        with patch("careersim_agent.services.retrieval_service.Chroma", FakeChroma):
            assert service._ensure_collection_indexed(
                "sim--x", tmp_path, doc_type="simulation"
            ) is not None
            assert service._ensure_collection_indexed("persona--y", tmp_path) is not None

        assert service._indexed_hashes["sim--x"] == {content_hash, ""}
        assert service._indexed_hashes["persona--y"] == set()

    def test_format_context_numbers_sources(self):
        service, _settings = _make_service(rerank_enabled=False)
        assert service.format_context([]) == ""
        text = service.format_context([
            Document(page_content="  hi  ", metadata={"source": "shared/a.md"}),
            Document(page_content="yo", metadata={}),
        ])
        assert text == (
            "[1] (source: shared/a.md)\nhi\n\n---\n\n[2] (source: unknown)\nyo"
        )

    def test_reset_clears_the_singleton(self):
        previous = rs._retrieval_service
        rs._retrieval_service = object()
        try:
            rs.reset_retrieval_service()
            assert rs._retrieval_service is None
        finally:
            rs._retrieval_service = previous
