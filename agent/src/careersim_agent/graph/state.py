"""State schema for the conversation graph."""

from typing import TypedDict, Literal, Optional, Annotated, Any
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class EvidenceItem(TypedDict, total=False):
    """Evidence for goal progress."""
    messageIndex: int
    role: Literal["user", "ai"]
    label: str
    score: float


class GoalProgressItem(TypedDict, total=False):
    """Progress tracking for a conversation goal."""
    goalNumber: int
    isOptional: bool
    title: str
    status: Literal["not_started", "in_progress", "achieved"]
    confidence: float
    evidence: list[EvidenceItem]
    startedAt: Optional[str]
    achievedAt: Optional[str]


class AnalysisResult(TypedDict, total=False):
    """NLP analysis result."""
    label: str  # emotion or sentiment label
    confidence: float
    source: str


class NodeTraceEntry(TypedDict):
    """Entry in the node execution trace."""
    node: str
    timestamp: str
    duration_ms: float
    input_summary: str
    output_summary: str


class ConversationState(TypedDict, total=False):
    """Main state schema for the conversation graph.
    
    This state is passed between nodes and maintains the conversation context.
    """
    # Session identification
    session_id: str
    
    # Conversation history (uses LangGraph's message reducer)
    messages: Annotated[list[BaseMessage], add_messages]
    
    # Persona and simulation context (loaded from JSON)
    persona: dict[str, Any]
    simulation: dict[str, Any]
    
    # Goal tracking
    goal_progress: list[GoalProgressItem]
    
    # Turn management: whose turn it is NEXT
    # 'user' = AI just spoke, waiting for user
    # 'ai' = User just spoke, AI should respond
    turn: Literal["user", "ai"]
    
    # Last messages for quick access
    last_user_message: Optional[str]
    last_ai_message: Optional[str]
    
    # Input field for new user messages
    user_message: Optional[str]
    
    # Proactive message handling
    proactive_trigger: Optional[Literal["followup", "inactivity", "start"]]
    should_send_proactive: bool
    proactive_count: int
    max_proactive_messages: int
    
    # Analysis results for user messages
    last_user_emotion: Optional[AnalysisResult]
    last_user_sentiment: Optional[AnalysisResult]
    
    # Analysis results for AI messages
    last_ai_emotion: Optional[AnalysisResult]
    last_ai_sentiment: Optional[AnalysisResult]
    
    # Evaluation flags
    needs_evaluation: bool
    evaluation_complete: bool
    
    # Metadata
    message_count: int
    started_at: Optional[str]
    
    # RAG retrieved context
    retrieved_context: Optional[str]
    
    # Error handling
    last_error: Optional[str]
    
    # Debug/tracing
    node_trace: list[NodeTraceEntry]


def create_initial_state(
    session_id: str,
    simulation: dict[str, Any],
    persona: dict[str, Any],
) -> ConversationState:
    """Create initial state for a new conversation.
    
    Args:
        session_id: Unique session identifier
        simulation: Simulation configuration
        persona: Persona configuration
        
    Returns:
        Initial conversation state
    """
    from datetime import datetime
    
    # Initialize goal progress from simulation goals
    goals = simulation.get("conversationGoals", [])
    goal_progress = [
        GoalProgressItem(
            goalNumber=goal["goalNumber"],
            isOptional=goal.get("isOptional", False),
            title=goal["title"],
            status="not_started",
            confidence=0.0,
            evidence=[],
        )
        for goal in goals
    ]
    
    return ConversationState(
        session_id=session_id,
        messages=[],
        persona=persona,
        simulation=simulation,
        goal_progress=goal_progress,
        turn="ai",  # AI starts (if startsConversation is true)
        last_user_message=None,
        last_ai_message=None,
        user_message=None,
        proactive_trigger="start" if persona.get("conversationStyle", {}).get("startsConversation") else None,
        should_send_proactive=False,
        proactive_count=0,
        max_proactive_messages=2,
        last_user_emotion=None,
        last_user_sentiment=None,
        last_ai_emotion=None,
        last_ai_sentiment=None,
        retrieved_context=None,
        needs_evaluation=False,
        evaluation_complete=False,
        message_count=0,
        started_at=datetime.now().isoformat(),
        last_error=None,
        node_trace=[],
    )


def get_current_goal(state: ConversationState) -> Optional[dict]:
    """Get the current goal being worked on.
    
    Returns the first unachieved required goal, or first unachieved optional goal
    if all required goals are achieved.
    """
    goals = state.get("simulation", {}).get("conversationGoals", [])
    progress = {p["goalNumber"]: p for p in state.get("goal_progress", [])}
    
    # Sort goals by number
    sorted_goals = sorted(goals, key=lambda g: g["goalNumber"])
    
    # Find first unachieved required goal
    for goal in sorted_goals:
        if goal.get("isOptional"):
            continue
        p = progress.get(goal["goalNumber"], {})
        if p.get("status") != "achieved":
            return goal
    
    # All required done, find first unachieved optional
    for goal in sorted_goals:
        if not goal.get("isOptional"):
            continue
        p = progress.get(goal["goalNumber"], {})
        if p.get("status") != "achieved":
            return goal
    
    return None  # All goals achieved
