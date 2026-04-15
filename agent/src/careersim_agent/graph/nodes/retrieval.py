"""Retrieval node for RAG context enrichment."""

import logging
from datetime import datetime
from typing import Any

from ..state import ConversationState, NodeTraceEntry
from ...config import get_settings

logger = logging.getLogger(__name__)


def _add_trace(
    state: ConversationState,
    node: str,
    start_time: datetime,
    input_summary: str,
    output_summary: str,
) -> list[NodeTraceEntry]:
    duration_ms = (datetime.now() - start_time).total_seconds() * 1000
    trace = state.get("node_trace", []).copy()
    trace.append(NodeTraceEntry(
        node=node,
        timestamp=start_time.isoformat(),
        duration_ms=round(duration_ms, 2),
        input_summary=input_summary,
        output_summary=output_summary,
    ))
    return trace


def retrieve_context(state: ConversationState) -> dict[str, Any]:
    """Retrieve relevant document chunks for the current user message.

    Uses the retrieval service to search across simulation-specific,
    persona-specific, and shared document collections.
    Writes formatted context to state["retrieved_context"].
    """
    start_time = datetime.now()
    session_id = state.get("session_id", "unknown")
    settings = get_settings()

    if not settings.rag_enabled:
        logger.debug(f"[{session_id}] RAG disabled, skipping retrieval")
        trace = _add_trace(
            state, "retrieve_context", start_time,
            "RAG disabled", "skipped",
        )
        return {"retrieved_context": None, "node_trace": trace}

    query = state.get("last_user_message", "")
    if not query:
        trace = _add_trace(
            state, "retrieve_context", start_time,
            "no user message", "skipped",
        )
        return {"retrieved_context": None, "node_trace": trace}

    sim_slug = state.get("simulation", {}).get("slug", "")
    persona_slug = state.get("persona", {}).get("slug", "")

    logger.info(f"[{session_id}] Retrieving RAG context for: '{query[:60]}...'")

    try:
        from ...services.retrieval_service import get_retrieval_service

        service = get_retrieval_service()
        docs = service.retrieve(
            query=query,
            simulation_slug=sim_slug,
            persona_slug=persona_slug,
        )
        formatted = service.format_context(docs)

        chunk_count = len(docs)
        output_summary = (
            f"{chunk_count} chunks retrieved ({len(formatted)} chars)"
            if formatted
            else "no relevant documents found"
        )

        logger.info(f"[{session_id}] RAG: {output_summary}")

        trace = _add_trace(
            state, "retrieve_context", start_time,
            f"query: '{query[:50]}...'",
            output_summary,
        )

        return {
            "retrieved_context": formatted or None,
            "node_trace": trace,
        }

    except Exception as e:
        logger.error(f"[{session_id}] RAG retrieval failed: {e}")
        trace = _add_trace(
            state, "retrieve_context", start_time,
            f"query: '{query[:50]}...'",
            f"ERROR: {e}",
        )
        return {"retrieved_context": None, "node_trace": trace}
