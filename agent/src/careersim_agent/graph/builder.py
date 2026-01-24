"""Graph builder for the conversation flow."""

import logging
from typing import Literal, Optional

from langgraph.graph import StateGraph, END

from .state import ConversationState
from .nodes import (
    process_user_input,
    generate_ai_response,
    analyze_user_input,
    analyze_ai_response,
    evaluate_goals,
    check_proactive_trigger,
    generate_proactive_message,
)

logger = logging.getLogger(__name__)


# Node names
PROCESS_INPUT = "process_input"
ANALYZE_INPUT = "analyze_input"
GENERATE_RESPONSE = "generate_response"
ANALYZE_RESPONSE = "analyze_response"
EVALUATE_GOALS = "evaluate_goals"
CHECK_PROACTIVE = "check_proactive"
GENERATE_PROACTIVE = "generate_proactive"


def _route_after_input(state: ConversationState) -> Literal[
    "analyze_input", "check_proactive"
]:
    """Route after processing input.
    
    - If user sent a message -> analyze_input
    - If proactive trigger -> check_proactive
    """
    if state.get("last_user_message") and state.get("needs_evaluation"):
        logger.debug("Routing to analyze_input (user message)")
        return ANALYZE_INPUT
    
    if state.get("proactive_trigger"):
        logger.debug(f"Routing to check_proactive (trigger: {state.get('proactive_trigger')})")
        return CHECK_PROACTIVE
    
    # Default: analyze input (shouldn't happen often)
    logger.debug("Routing to analyze_input (default)")
    return ANALYZE_INPUT


def _route_after_evaluation(state: ConversationState) -> Literal[
    "check_proactive", "__end__"
]:
    """Route after goal evaluation.
    
    Check if we should send proactive follow-up messages.
    """
    # Always check for proactive messages after evaluation
    logger.debug("Routing to check_proactive after evaluation")
    return CHECK_PROACTIVE


def _route_after_proactive_check(state: ConversationState) -> Literal[
    "generate_proactive", "__end__"
]:
    """Route after proactive trigger check.
    
    - If should send proactive -> generate_proactive
    - Otherwise -> end
    """
    if state.get("should_send_proactive"):
        logger.debug("Routing to generate_proactive")
        return GENERATE_PROACTIVE
    
    logger.debug("Routing to END (no proactive needed)")
    return END


def _route_after_proactive_message(state: ConversationState) -> Literal[
    "check_proactive", "__end__"
]:
    """Route after generating proactive message.
    
    Check if we should continue burst (followup messages).
    """
    trigger = state.get("proactive_trigger")
    count = state.get("proactive_count", 0)
    max_msg = state.get("max_proactive_messages", 1)
    
    # For followup bursts, loop back to check if more needed
    if trigger == "followup" and count < max_msg:
        logger.debug(f"Routing to check_proactive for more followups ({count}/{max_msg})")
        return CHECK_PROACTIVE
    
    logger.debug("Routing to END (proactive complete)")
    return END


def build_graph() -> StateGraph:
    """Build the conversation state graph.
    
    Flow:
    1. process_input -> [analyze_input | check_proactive]
    2. analyze_input -> generate_response
    3. generate_response -> analyze_response
    4. analyze_response -> evaluate_goals
    5. evaluate_goals -> check_proactive
    6. check_proactive -> [generate_proactive | END]
    7. generate_proactive -> [check_proactive | END]
    """
    logger.info("Building conversation graph...")
    
    # Create graph
    graph = StateGraph(ConversationState)
    
    # Add nodes
    graph.add_node(PROCESS_INPUT, process_user_input)
    graph.add_node(ANALYZE_INPUT, analyze_user_input)
    graph.add_node(GENERATE_RESPONSE, generate_ai_response)
    graph.add_node(ANALYZE_RESPONSE, analyze_ai_response)
    graph.add_node(EVALUATE_GOALS, evaluate_goals)
    graph.add_node(CHECK_PROACTIVE, check_proactive_trigger)
    graph.add_node(GENERATE_PROACTIVE, generate_proactive_message)
    
    # Set entry point
    graph.set_entry_point(PROCESS_INPUT)
    
    # Add edges
    # After processing input, route based on content
    graph.add_conditional_edges(
        PROCESS_INPUT,
        _route_after_input,
        {
            ANALYZE_INPUT: ANALYZE_INPUT,
            CHECK_PROACTIVE: CHECK_PROACTIVE,
        }
    )
    
    # Linear flow through conversation pipeline
    graph.add_edge(ANALYZE_INPUT, GENERATE_RESPONSE)
    graph.add_edge(GENERATE_RESPONSE, ANALYZE_RESPONSE)
    graph.add_edge(ANALYZE_RESPONSE, EVALUATE_GOALS)
    
    # After evaluation, check for proactive messages
    graph.add_conditional_edges(
        EVALUATE_GOALS,
        _route_after_evaluation,
        {
            CHECK_PROACTIVE: CHECK_PROACTIVE,
            END: END,
        }
    )
    
    # After proactive check, generate or end
    graph.add_conditional_edges(
        CHECK_PROACTIVE,
        _route_after_proactive_check,
        {
            GENERATE_PROACTIVE: GENERATE_PROACTIVE,
            END: END,
        }
    )
    
    # After generating proactive, check for more or end
    graph.add_conditional_edges(
        GENERATE_PROACTIVE,
        _route_after_proactive_message,
        {
            CHECK_PROACTIVE: CHECK_PROACTIVE,
            END: END,
        }
    )
    
    logger.info("Graph built successfully")
    return graph


# Singleton compiled graph
_compiled_graph = None


def get_graph():
    """Get the compiled conversation graph (singleton).
    
    Returns:
        Compiled LangGraph ready for invocation
    """
    global _compiled_graph
    
    if _compiled_graph is None:
        logger.info("Compiling conversation graph...")
        graph = build_graph()
        _compiled_graph = graph.compile()
        logger.info("Graph compiled successfully")
    
    return _compiled_graph


def reset_graph():
    """Reset the compiled graph (useful for testing)."""
    global _compiled_graph
    _compiled_graph = None
