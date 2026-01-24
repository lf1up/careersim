"""Conversation nodes for processing input and generating responses."""

import logging
from datetime import datetime
from typing import Any

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..state import ConversationState, NodeTraceEntry
from ...config import get_settings
from ...prompts import build_persona_system_prompt

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


def process_user_input(state: ConversationState) -> dict[str, Any]:
    """Process incoming user input and prepare state for response generation.
    
    This is the entry point node that:
    - Handles new user messages
    - Handles proactive triggers (start, inactivity)
    - Sets up evaluation flags
    """
    start_time = datetime.now()
    session_id = state.get("session_id", "unknown")
    user_message = state.get("user_message")
    proactive_trigger = state.get("proactive_trigger")
    
    logger.info(f"[{session_id}] Processing input (trigger: {proactive_trigger or 'none'})")
    
    updates: dict[str, Any] = {}
    input_summary = ""
    output_summary = ""
    
    # Priority 1: User sent a message
    if user_message:
        input_summary = f"user_message: {user_message[:50]}..."
        logger.info(f"[{session_id}] User message: {user_message[:50]}...")
        
        # Add to messages
        messages = list(state.get("messages", []))
        messages.append(HumanMessage(content=user_message))
        
        updates["messages"] = messages
        updates["last_user_message"] = user_message
        updates["user_message"] = None  # Clear the input field
        updates["turn"] = "ai"
        updates["needs_evaluation"] = True
        updates["proactive_trigger"] = None  # Clear any stale triggers
        updates["proactive_count"] = 0
        updates["message_count"] = state.get("message_count", 0) + 1
        
        output_summary = "Added user message, set turn=ai, needs_evaluation=True"
    
    # Priority 2: Proactive trigger (start, inactivity)
    elif proactive_trigger:
        input_summary = f"proactive_trigger: {proactive_trigger}"
        logger.info(f"[{session_id}] Proactive trigger: {proactive_trigger}")
        
        updates["needs_evaluation"] = False
        updates["should_send_proactive"] = False  # Will be set by check_proactive_trigger
        
        output_summary = f"Proactive trigger {proactive_trigger}, skipping normal flow"
    
    else:
        input_summary = "No input"
        output_summary = "No action needed"
        logger.warning(f"[{session_id}] No user message and no proactive trigger")
    
    # Add trace
    updates["node_trace"] = _add_trace(
        state, "process_user_input", start_time, input_summary, output_summary
    )
    
    return updates


def generate_ai_response(state: ConversationState) -> dict[str, Any]:
    """Generate AI response using the persona system prompt.
    
    Uses ChatOpenAI to generate a response based on:
    - Persona configuration
    - Simulation context
    - Conversation history
    - Current goal progress
    """
    start_time = datetime.now()
    session_id = state.get("session_id", "unknown")
    
    logger.info(f"[{session_id}] Generating AI response")
    
    try:
        settings = get_settings()
        
        # Build system prompt
        system_prompt = build_persona_system_prompt(
            persona=state.get("persona", {}),
            simulation=state.get("simulation", {}),
            goal_progress=state.get("goal_progress", []),
        )
        
        # Initialize model with full config
        model_kwargs = {
            "model": settings.openai_model,
            "temperature": settings.openai_temperature,
            "max_tokens": settings.openai_max_tokens,
            "api_key": settings.openai_api_key,
            "top_p": settings.openai_top_p,
            "frequency_penalty": settings.openai_frequency_penalty,
            "presence_penalty": settings.openai_presence_penalty,
        }
        if settings.openai_base_url:
            model_kwargs["base_url"] = settings.openai_base_url
        
        model = ChatOpenAI(**model_kwargs)
        
        # Build message list with system prompt
        messages = [SystemMessage(content=system_prompt)]
        messages.extend(state.get("messages", []))
        
        # Generate response
        response = model.invoke(messages)
        ai_content = str(response.content)
        
        if not ai_content.strip():
            raise ValueError("Empty AI response generated")
        
        logger.info(f"[{session_id}] AI response: {ai_content[:50]}...")
        
        # Add to messages
        updated_messages = list(state.get("messages", []))
        updated_messages.append(AIMessage(content=ai_content))
        
        # Add trace
        trace = _add_trace(
            state, "generate_ai_response", start_time,
            f"messages: {len(state.get('messages', []))}",
            f"response: {ai_content[:50]}..."
        )
        
        return {
            "messages": updated_messages,
            "last_ai_message": ai_content,
            "turn": "user",
            "message_count": state.get("message_count", 0) + 1,
            "node_trace": trace,
        }
        
    except Exception as e:
        logger.error(f"[{session_id}] Error generating AI response: {e}")
        
        trace = _add_trace(
            state, "generate_ai_response", start_time,
            f"messages: {len(state.get('messages', []))}",
            f"ERROR: {str(e)}"
        )
        
        return {
            "last_error": str(e),
            "node_trace": trace,
        }
