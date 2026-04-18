"""Analysis nodes for sentiment and emotion detection."""

import logging
from datetime import datetime
from typing import Any

from ..state import ConversationState, NodeTraceEntry, AnalysisResult
from ...services import get_eval_service

logger = logging.getLogger(__name__)


def _add_trace(
    state: ConversationState,
    node: str,
    start_time: datetime,
    input_summary: str,
    output_summary: str,
) -> list[NodeTraceEntry]:
    """Add a trace entry for node execution."""
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


def analyze_user_input(state: ConversationState) -> dict[str, Any]:
    """Analyze the user's message for sentiment and emotion."""
    start_time = datetime.now()
    session_id = state.get("session_id", "unknown")
    last_user_message = state.get("last_user_message")

    if not last_user_message:
        logger.debug(f"[{session_id}] No user message to analyze")
        trace = _add_trace(
            state, "analyze_user_input", start_time,
            "No message", "Skipped"
        )
        return {"node_trace": trace}

    logger.info(f"[{session_id}] Analyzing user input")

    try:
        result = get_eval_service().analyze_text(last_user_message)

        logger.info(
            f"[{session_id}] User analysis: "
            f"sentiment={result['sentiment']}, "
            f"emotion={result['emotion']}"
        )

        trace = _add_trace(
            state, "analyze_user_input", start_time,
            f"message: {last_user_message[:30]}...",
            f"sentiment={result['sentiment']}, emotion={result['emotion']}"
        )

        return {
            "last_user_sentiment": AnalysisResult(
                label=result["sentiment"],
                confidence=result["sentiment_confidence"],
                source=result["source"],
            ),
            "last_user_emotion": AnalysisResult(
                label=result["emotion"],
                confidence=result["emotion_confidence"],
                source=result["source"],
            ),
            "node_trace": trace,
        }

    except Exception as e:
        logger.warning(f"[{session_id}] User input analysis failed: {e}")

        trace = _add_trace(
            state, "analyze_user_input", start_time,
            f"message: {last_user_message[:30]}...",
            f"ERROR: {str(e)}"
        )

        return {
            "last_user_sentiment": AnalysisResult(
                label="neutral", confidence=0.5, source="fallback",
            ),
            "last_user_emotion": AnalysisResult(
                label="neutral", confidence=0.5, source="fallback",
            ),
            "node_trace": trace,
        }


def analyze_ai_response(state: ConversationState) -> dict[str, Any]:
    """Analyze the AI's response for sentiment and emotion."""
    start_time = datetime.now()
    session_id = state.get("session_id", "unknown")
    last_ai_message = state.get("last_ai_message")

    if not last_ai_message:
        logger.debug(f"[{session_id}] No AI message to analyze")
        trace = _add_trace(
            state, "analyze_ai_response", start_time,
            "No message", "Skipped"
        )
        return {"node_trace": trace}

    logger.info(f"[{session_id}] Analyzing AI response")

    try:
        result = get_eval_service().analyze_text(last_ai_message)

        logger.info(
            f"[{session_id}] AI analysis: "
            f"sentiment={result['sentiment']}, "
            f"emotion={result['emotion']}"
        )

        trace = _add_trace(
            state, "analyze_ai_response", start_time,
            f"message: {last_ai_message[:30]}...",
            f"sentiment={result['sentiment']}, emotion={result['emotion']}"
        )

        return {
            "last_ai_sentiment": AnalysisResult(
                label=result["sentiment"],
                confidence=result["sentiment_confidence"],
                source=result["source"],
            ),
            "last_ai_emotion": AnalysisResult(
                label=result["emotion"],
                confidence=result["emotion_confidence"],
                source=result["source"],
            ),
            "node_trace": trace,
        }

    except Exception as e:
        logger.warning(f"[{session_id}] AI response analysis failed: {e}")

        trace = _add_trace(
            state, "analyze_ai_response", start_time,
            f"message: {last_ai_message[:30]}...",
            f"ERROR: {str(e)}"
        )

        return {
            "last_ai_sentiment": AnalysisResult(
                label="neutral", confidence=0.5, source="fallback",
            ),
            "last_ai_emotion": AnalysisResult(
                label="neutral", confidence=0.5, source="fallback",
            ),
            "node_trace": trace,
        }
