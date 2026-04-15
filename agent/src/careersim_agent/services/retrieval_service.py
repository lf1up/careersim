"""RAG retrieval service using ChromaDB and OpenAI embeddings.

Indexes markdown documents from data/documents/ into per-simulation,
per-persona, and shared collections. Provides semantic search across
relevant collections for a given simulation session.
"""

import hashlib
import logging
from pathlib import Path
from typing import Optional

import chromadb
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

from ..config import get_settings

logger = logging.getLogger(__name__)

COLLECTION_PREFIX_SIM = "sim"
COLLECTION_PREFIX_PERSONA = "persona"
COLLECTION_SHARED = "shared"


def _sanitize_collection_name(raw: str) -> str:
    """ChromaDB collection names must be 3-63 chars, alphanumeric/underscores/hyphens."""
    name = raw[:63]
    sanitized = "".join(c if c.isalnum() or c in "-_" else "-" for c in name)
    if len(sanitized) < 3:
        sanitized = sanitized.ljust(3, "-")
    return sanitized


def _file_content_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def _load_markdown_files(directory: Path) -> list[Document]:
    """Load all .md files from a directory into LangChain Documents."""
    docs: list[Document] = []
    if not directory.exists():
        return docs

    for md_file in sorted(directory.glob("*.md")):
        try:
            text = md_file.read_text(encoding="utf-8")
            if text.strip():
                docs.append(Document(
                    page_content=text,
                    metadata={
                        "source": str(md_file.relative_to(directory.parent.parent)),
                        "filename": md_file.name,
                    },
                ))
        except Exception as e:
            logger.warning(f"Failed to read {md_file}: {e}")

    return docs


class RetrievalService:
    """Manages ChromaDB collections and semantic retrieval for simulations."""

    def __init__(self) -> None:
        settings = get_settings()

        self._embeddings = OpenAIEmbeddings(
            model=settings.rag_embedding_model,
            api_key=settings.openai_api_key,
            **({"base_url": settings.openai_base_url} if settings.openai_base_url else {}),
        )

        self._chunk_size = settings.rag_chunk_size
        self._chunk_overlap = settings.rag_chunk_overlap
        self._top_k = settings.rag_top_k

        persist_dir = Path(settings.rag_chroma_persist_dir)
        if not persist_dir.is_absolute():
            persist_dir = Path.cwd() / persist_dir
        self._persist_dir = persist_dir

        self._client = chromadb.PersistentClient(path=str(self._persist_dir))
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=self._chunk_size,
            chunk_overlap=self._chunk_overlap,
            separators=["\n## ", "\n### ", "\n\n", "\n", " "],
        )

        self._indexed_hashes: dict[str, set[str]] = {}

        logger.info(
            f"RetrievalService initialized (persist_dir={self._persist_dir}, "
            f"embedding_model={settings.rag_embedding_model})"
        )

    def _get_documents_dir(self) -> Path:
        """Resolve the data/documents/ directory."""
        from .data_loader import _get_data_dir
        return _get_data_dir() / "documents"

    def _collection_name(self, prefix: str, slug: str = "") -> str:
        if slug:
            return _sanitize_collection_name(f"{prefix}--{slug}")
        return _sanitize_collection_name(prefix)

    def _ensure_collection_indexed(
        self,
        collection_name: str,
        doc_dir: Path,
    ) -> Optional[Chroma]:
        """Index documents from doc_dir into the named collection if needed.

        Skips files whose content hash is already in the collection metadata
        to avoid re-embedding unchanged documents.
        """
        raw_docs = _load_markdown_files(doc_dir)
        if not raw_docs:
            return None

        chunks = self._splitter.split_documents(raw_docs)
        if not chunks:
            return None

        existing_hashes = self._indexed_hashes.get(collection_name, set())

        new_chunks: list[Document] = []
        new_hashes: set[str] = set()
        for chunk in chunks:
            h = _file_content_hash(chunk.page_content)
            chunk.metadata["content_hash"] = h
            if h not in existing_hashes:
                new_chunks.append(chunk)
                new_hashes.add(h)

        store = Chroma(
            client=self._client,
            collection_name=collection_name,
            embedding_function=self._embeddings,
        )

        if new_chunks:
            logger.info(
                f"Indexing {len(new_chunks)} new chunks into '{collection_name}' "
                f"(from {doc_dir})"
            )
            store.add_documents(new_chunks)
            self._indexed_hashes.setdefault(collection_name, set()).update(new_hashes)
        else:
            logger.debug(f"Collection '{collection_name}' is up to date")

        if collection_name not in self._indexed_hashes:
            try:
                col = self._client.get_collection(collection_name)
                all_meta = col.get(include=["metadatas"])["metadatas"] or []
                self._indexed_hashes[collection_name] = {
                    m.get("content_hash", "") for m in all_meta if m
                }
            except Exception:
                self._indexed_hashes[collection_name] = set()

        return store

    def index_for_session(
        self,
        simulation_slug: str,
        persona_slug: str,
    ) -> None:
        """Pre-index all documents relevant to a simulation session.

        Call this when a session starts to ensure collections are warm.
        """
        docs_dir = self._get_documents_dir()

        sim_dir = docs_dir / "simulations" / simulation_slug
        self._ensure_collection_indexed(
            self._collection_name(COLLECTION_PREFIX_SIM, simulation_slug),
            sim_dir,
        )

        persona_dir = docs_dir / "personas" / persona_slug
        self._ensure_collection_indexed(
            self._collection_name(COLLECTION_PREFIX_PERSONA, persona_slug),
            persona_dir,
        )

        shared_dir = docs_dir / "shared"
        self._ensure_collection_indexed(
            self._collection_name(COLLECTION_SHARED),
            shared_dir,
        )

        logger.info(
            f"Indexed documents for session: sim={simulation_slug}, persona={persona_slug}"
        )

    def retrieve(
        self,
        query: str,
        simulation_slug: str,
        persona_slug: str,
        top_k: Optional[int] = None,
    ) -> list[Document]:
        """Retrieve relevant document chunks for a query.

        Searches across simulation-specific, persona-specific, and shared
        collections, then merges and deduplicates by relevance score.

        Returns at most top_k total chunks across all collections.
        """
        k = top_k or self._top_k
        per_collection_k = max(k, 3)

        collection_names = [
            self._collection_name(COLLECTION_PREFIX_SIM, simulation_slug),
            self._collection_name(COLLECTION_PREFIX_PERSONA, persona_slug),
            self._collection_name(COLLECTION_SHARED),
        ]

        scored_docs: list[tuple[Document, float]] = []

        for col_name in collection_names:
            try:
                col = self._client.get_collection(col_name)
                if col.count() == 0:
                    continue
            except Exception:
                continue

            store = Chroma(
                client=self._client,
                collection_name=col_name,
                embedding_function=self._embeddings,
            )

            try:
                results = store.similarity_search_with_relevance_scores(
                    query, k=per_collection_k
                )
                for doc, score in results:
                    doc.metadata["collection"] = col_name
                    scored_docs.append((doc, score))
            except Exception as e:
                logger.warning(f"Retrieval from '{col_name}' failed: {e}")

        scored_docs.sort(key=lambda x: x[1], reverse=True)

        seen_hashes: set[str] = set()
        unique: list[Document] = []
        for doc, _score in scored_docs:
            h = doc.metadata.get("content_hash", doc.page_content[:100])
            if h not in seen_hashes:
                seen_hashes.add(h)
                unique.append(doc)
            if len(unique) >= k:
                break

        logger.debug(
            f"Retrieved {len(unique)} chunks for query: '{query[:60]}...' "
            f"(searched {len(collection_names)} collections)"
        )
        return unique

    def format_context(self, docs: list[Document]) -> str:
        """Format retrieved documents into a prompt-friendly string."""
        if not docs:
            return ""

        sections: list[str] = []
        for i, doc in enumerate(docs, 1):
            source = doc.metadata.get("source", "unknown")
            sections.append(f"[{i}] (source: {source})\n{doc.page_content.strip()}")

        return "\n\n---\n\n".join(sections)


_retrieval_service: Optional[RetrievalService] = None


def get_retrieval_service() -> RetrievalService:
    """Get the singleton RetrievalService instance."""
    global _retrieval_service
    if _retrieval_service is None:
        _retrieval_service = RetrievalService()
    return _retrieval_service


def reset_retrieval_service() -> None:
    """Reset the singleton (useful for testing)."""
    global _retrieval_service
    _retrieval_service = None
