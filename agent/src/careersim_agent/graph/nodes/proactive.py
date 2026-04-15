"""Proactive message nodes for handling triggers and generating messages."""

import logging
import random
from datetime import datetime
from typing import Any

from langchain_core.messages import AIMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..state import ConversationState, NodeTraceEntry, AnalysisResult
from ...config import get_settings
from ...prompts import (
    build_proactive_start_prompt,
    build_proactive_inactivity_prompt,
    build_proactive_followup_prompt,
)
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


def _get_recent_ai_messages(state: ConversationState, count: int = 3) -> list[str]:
    """Get recent AI messages for anti-repetition."""
    messages = state.get("messages", [])
    ai_messages = []
    
    for msg in reversed(messages):
        if hasattr(msg, "type") and msg.type == "ai":
            ai_messages.append(str(msg.content))
        elif isinstance(msg, AIMessage):
            ai_messages.append(str(msg.content))
        
        if len(ai_messages) >= count:
            break
    
    return ai_messages


def check_proactive_trigger(state: ConversationState) -> dict[str, Any]:
    """Check if a proactive message should be sent.
    
    Handles:
    - Start trigger (conversation opening)
    - Inactivity trigger (nudge after silence)
    - Followup trigger (burst messages)
    """
    start_time = datetime.now()
    session_id = state.get("session_id", "unknown")
    trigger = state.get("proactive_trigger")
    
    logger.info(f"[{session_id}] Checking proactive trigger: {trigger}")
    
    if not trigger:
        # No trigger - check for followup based on burstiness
        conv_style = state.get("persona", {}).get("conversationStyle", {})
        burst = conv_style.get("burstiness", {})
        
        if burst:
            burst_min = max(1, burst.get("min", 1))
            burst_max = max(burst_min, burst.get("max", 1))
            
            # If burstMax > 1, there's potential for follow-ups
            if burst_max > 1 and state.get("proactive_count", 0) == 0:
                # Probability based on burst range
                range_factor = (burst_max - burst_min) / burst_max if burst_max > 0 else 0
                burst_prob = 0.3 + (range_factor * 0.4)  # 30-70% chance
                
                if random.random() < burst_prob:
                    # Determine burst count
                    burst_count = random.randint(burst_min, burst_max)
                    additional = max(0, burst_count - 1)
                    
                    if additional > 0:
                        logger.info(f"[{session_id}] Followup triggered (burst: {additional} additional)")
                        
                        trace = _add_trace(
                            state, "check_proactive_trigger", start_time,
                            "burstiness check",
                            f"followup triggered, max={additional}"
                        )
                        
                        return {
                            "should_send_proactive": True,
                            "proactive_trigger": "followup",
                            "max_proactive_messages": additional,
                            "node_trace": trace,
                        }
        
        # No followup needed
        trace = _add_trace(
            state, "check_proactive_trigger", start_time,
            "No trigger", "No proactive needed"
        )
        
        return {
            "should_send_proactive": False,
            "node_trace": trace,
        }
    
    # Handle explicit triggers
    if trigger == "start":
        # Always send start message if persona starts conversation
        conv_style = state.get("persona", {}).get("conversationStyle", {})
        starts = conv_style.get("startsConversation", True)
        
        trace = _add_trace(
            state, "check_proactive_trigger", start_time,
            f"trigger: {trigger}",
            f"should_send={starts}"
        )
        
        return {
            "should_send_proactive": starts,
            "max_proactive_messages": 1,
            "node_trace": trace,
        }
    
    elif trigger == "inactivity":
        # Check inactivity nudge limits
        conv_style = state.get("persona", {}).get("conversationStyle", {})
        nudges = conv_style.get("inactivityNudges", {})
        
        if not nudges:
            trace = _add_trace(
                state, "check_proactive_trigger", start_time,
                f"trigger: {trigger}",
                "No nudges configured"
            )
            return {
                "should_send_proactive": False,
                "node_trace": trace,
            }
        
        nudge_max = nudges.get("max", 2)
        current_count = state.get("proactive_count", 0)
        
        if current_count >= nudge_max:
            logger.info(f"[{session_id}] Max inactivity nudges reached ({current_count}/{nudge_max})")
            trace = _add_trace(
                state, "check_proactive_trigger", start_time,
                f"trigger: {trigger}, count: {current_count}/{nudge_max}",
                "Max nudges reached"
            )
            return {
                "should_send_proactive": False,
                "node_trace": trace,
            }
        
        trace = _add_trace(
            state, "check_proactive_trigger", start_time,
            f"trigger: {trigger}, count: {current_count}/{nudge_max}",
            "Nudge approved"
        )
        
        return {
            "should_send_proactive": True,
            "max_proactive_messages": nudge_max,
            "node_trace": trace,
        }
    
    elif trigger == "followup":
        # Continue followup burst
        max_msg = state.get("max_proactive_messages", 2)
        current = state.get("proactive_count", 0)
        
        should_send = current < max_msg
        
        trace = _add_trace(
            state, "check_proactive_trigger", start_time,
            f"trigger: {trigger}, count: {current}/{max_msg}",
            f"should_send={should_send}"
        )
        
        return {
            "should_send_proactive": should_send,
            "node_trace": trace,
        }
    
    # Unknown trigger
    trace = _add_trace(
        state, "check_proactive_trigger", start_time,
        f"trigger: {trigger}",
        "Unknown trigger, no action"
    )
    
    return {
        "should_send_proactive": False,
        "node_trace": trace,
    }


def generate_proactive_message(state: ConversationState) -> dict[str, Any]:
    """Generate a proactive message based on trigger type.
    
    Handles:
    - Start: Opening message
    - Inactivity: Nudge message
    - Followup: Additional context
    """
    start_time = datetime.now()
    session_id = state.get("session_id", "unknown")
    trigger = state.get("proactive_trigger", "followup")
    
    logger.info(f"[{session_id}] Generating proactive message ({trigger})")
    
    try:
        settings = get_settings()
        persona = state.get("persona", {})
        simulation = state.get("simulation", {})
        
        # Get recent AI messages for anti-repetition
        recent_ai_messages = _get_recent_ai_messages(state, 3)
        
        # Build prompt based on trigger
        if trigger == "start":
            prompt_text = build_proactive_start_prompt(persona, simulation)
        elif trigger == "inactivity":
            prompt_text = build_proactive_inactivity_prompt(
                persona,
                simulation,
                state.get("last_user_message"),
                state.get("last_ai_message"),
                recent_ai_messages,
            )
        else:  # followup
            prompt_text = build_proactive_followup_prompt(
                persona,
                state.get("last_user_message"),
                state.get("last_ai_message"),
                recent_ai_messages,
            )
        
        # Initialize model with slightly higher temperature for variety
        model_kwargs = {
            "model": settings.openai_model,
            "temperature": min(1.0, settings.openai_temperature * 1.2),
            "max_tokens": settings.openai_max_tokens,
            "api_key": settings.openai_api_key,
            "top_p": settings.openai_top_p,
            "frequency_penalty": min(2.0, settings.openai_frequency_penalty + 0.2),
            "presence_penalty": min(2.0, settings.openai_presence_penalty + 0.1),
        }
        if settings.openai_base_url:
            model_kwargs["base_url"] = settings.openai_base_url
        
        model = ChatOpenAI(**model_kwargs)
        
        # Generate response
        response = model.invoke([SystemMessage(content=prompt_text)])
        ai_content = str(response.content)
        
        if not ai_content.strip():
            raise ValueError("Empty proactive message generated")
        
        logger.info(f"[{session_id}] Proactive message: {ai_content[:50]}...")
        
        # Add to messages
        updated_messages = list(state.get("messages", []))
        updated_messages.append(AIMessage(content=ai_content))
        
        try:
            analysis = get_eval_service().analyze_text(ai_content)
        except Exception:
            analysis = {
                "sentiment": "neutral", "sentiment_confidence": 0.5,
                "emotion": "neutral", "emotion_confidence": 0.5,
                "source": "fallback",
            }
        
        new_count = state.get("proactive_count", 0) + 1
        
        trace = _add_trace(
            state, "generate_proactive_message", start_time,
            f"trigger: {trigger}",
            f"message: {ai_content[:30]}..., count: {new_count}"
        )
        
        return {
            "messages": updated_messages,
            "last_ai_message": ai_content,
            "turn": "user",
            "proactive_count": new_count,
            "message_count": state.get("message_count", 0) + 1,
            "last_ai_sentiment": AnalysisResult(
                label=analysis["sentiment"],
                confidence=analysis["sentiment_confidence"],
                source=analysis.get("source", "eval"),
            ),
            "last_ai_emotion": AnalysisResult(
                label=analysis["emotion"],
                confidence=analysis["emotion_confidence"],
                source=analysis.get("source", "eval"),
            ),
            "node_trace": trace,
        }
        
    except Exception as e:
        logger.error(f"[{session_id}] Error generating proactive message: {e}")
        
        trace = _add_trace(
            state, "generate_proactive_message", start_time,
            f"trigger: {trigger}",
            f"ERROR: {str(e)}"
        )
        
        return {
            "last_error": str(e),
            "should_send_proactive": False,
            "proactive_trigger": None,
            "node_trace": trace,
        }
