"""Optional local cross-encoder reranker for RAG retrieval.

Single-vector (bi-encoder) retrieval scores query and chunk independently,
which cannot express conjunctive / multi-constraint relevance (see
arXiv:2508.21038). A cross-encoder scores the (query, chunk) pair jointly
and recovers a large part of that gap over a small candidate set.

This module is intentionally fail-open and dependency-optional:
- `sentence-transformers` lives in the `rerank` extra, not base deps.
- The model is loaded lazily on first use, never at import time.
- Any load/inference failure logs a warning and disables reranking so
  retrieval degrades to plain vector order instead of raising.
"""

import logging
from typing import Any, Optional, Sequence

logger = logging.getLogger(__name__)


class Reranker:
    """Lazy wrapper around a sentence-transformers CrossEncoder."""

    def __init__(self, model_name: str) -> None:
        self._model_name = model_name
        self._model: Any = None
        self._disabled = False

    def _ensure_model(self) -> bool:
        """Load the model on first use. Returns False if unavailable."""
        if self._disabled:
            return False
        if self._model is not None:
            return True
        try:
            from sentence_transformers import CrossEncoder

            self._model = CrossEncoder(self._model_name)
            logger.info(f"Reranker loaded cross-encoder '{self._model_name}'")
            return True
        except Exception as e:
            logger.warning(
                f"Reranker disabled: failed to load '{self._model_name}': {e}"
            )
            self._disabled = True
            return False

    def score(self, query: str, texts: Sequence[str]) -> Optional[list[float]]:
        """Score (query, text) pairs. Returns None on any failure."""
        if not texts:
            return []
        if not self._ensure_model():
            return None
        try:
            pairs = [(query, t) for t in texts]
            scores = self._model.predict(pairs)
            return [float(s) for s in scores]
        except Exception as e:
            logger.warning(f"Reranker inference failed, disabling: {e}")
            self._disabled = True
            return None


_reranker: Optional[Reranker] = None


def get_reranker(model_name: str) -> Reranker:
    """Get the singleton Reranker (created with the given model on first call)."""
    global _reranker
    if _reranker is None:
        _reranker = Reranker(model_name)
    return _reranker


def reset_reranker() -> None:
    """Reset the singleton (useful for testing)."""
    global _reranker
    _reranker = None
