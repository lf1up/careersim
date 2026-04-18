"""Stateless conversation service — the core logic layer.

Accepts a ConversationState, runs the graph, and returns the updated state.
Both the Gradio dev UI and the production FastAPI server delegate here.

Supports both batch (invoke) and streaming (stream) modes. Streaming yields
individual MessageEvent objects as each AI message is generated, enabling
incremental display with persona-appropriate typing delays.
"""

import json
import logging
import uuid
from collections.abc import Generator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.graph.message import add_messages

from ..config import get_settings
from ..graph import get_graph
from ..graph.state import ConversationState, GoalProgressItem, create_initial_state
from .data_loader import list_personas, list_simulations, load_simulation

logger = logging.getLogger(__name__)

# Node names that produce new AI messages — must match builder.py constants
_MESSAGE_NODES = frozenset({"generate_response", "generate_proactive"})


# -- Wire-format serialisation helpers ----------------------------------------

def serialize_state(state: ConversationState) -> dict[str, Any]:
    """Convert a ConversationState (with LangChain message objects) into a
    plain JSON-serialisable dict suitable for sending over HTTP."""
    out: dict[str, Any] = {}
    for key, value in state.items():
        if key == "messages":
            out[key] = [
                {"role": getattr(m, "type", "unknown"), "content": str(m.content)}
                for m in value
            ]
        else:
            out[key] = value
    return out


def deserialize_state(data: dict[str, Any]) -> ConversationState:
    """Reconstruct a ConversationState from the plain-dict wire format,
    converting message dicts back into LangChain message objects."""
    messages_raw = data.get("messages", [])
    messages: list[BaseMessage] = []
    for m in messages_raw:
        role = m.get("role", "unknown")
        content = m.get("content", "")
        if role == "human":
            messages.append(HumanMessage(content=content))
        elif role == "ai":
            messages.append(AIMessage(content=content))

    state = dict(data)
    state["messages"] = messages
    return state  # type: ignore[return-value]


# -- Typing-delay helpers -----------------------------------------------------

def compute_typing_delay(text: str, wpm: int) -> float:
    """Compute a simulated typing delay in seconds.

    Args:
        text: The message content.
        wpm: Words-per-minute from the persona's ``typingSpeedWpm``.

    Returns:
        Delay in seconds (clamped to a sensible range).
    """
    if wpm <= 0:
        return 0.0
    word_count = len(text.split())
    delay = (word_count / wpm) * 60.0
    return max(0.5, min(delay, 12.0))


def get_typing_wpm(state: ConversationState) -> int:
    """Extract typingSpeedWpm from the persona in state, with a fallback."""
    return (
        state.get("persona", {})
        .get("conversationStyle", {})
        .get("typingSpeedWpm", 120)
    )


# -- Streaming events ---------------------------------------------------------

@dataclass
class MessageEvent:
    """Emitted each time the graph produces a new AI message.

    The final event in every stream has ``is_final=True`` and carries the
    complete post-graph state (including non-message nodes like goal evaluation
    and proactive checks that run after the last AI message).
    """
    content: str
    node: str
    typing_delay_sec: float
    message_index: int
    is_followup: bool
    state: ConversationState = field(repr=False)
    is_final: bool = False


# -- Core stateless operations ------------------------------------------------

class ConversationService:
    """Stateless service: receives full state, invokes the graph, returns new state."""

    def __init__(self) -> None:
        self._graph = get_graph()

    # -- Session init (unchanged) ---------------------------------------------

    def init_session(
        self,
        simulation_slug: str,
        session_id: Optional[str] = None,
    ) -> ConversationState:
        """Create initial state for a new conversation and optionally index RAG.

        Args:
            simulation_slug: Which simulation to load.
            session_id: Caller-supplied ID (the backend owns ID generation in
                        production). Falls back to a short random UUID.

        Returns:
            A fully-initialised ConversationState ready for graph invocation.
        """
        simulation, persona = load_simulation(simulation_slug)
        sid = session_id or str(uuid.uuid4())[:8]

        state = create_initial_state(
            session_id=sid,
            simulation=simulation,
            persona=persona,
        )

        settings = get_settings()
        if settings.rag_enabled:
            try:
                from .retrieval_service import get_retrieval_service

                rag = get_retrieval_service()
                rag.index_for_session(
                    simulation_slug=simulation_slug,
                    persona_slug=persona["slug"],
                )
            except Exception as e:
                logger.warning(f"RAG indexing failed (non-fatal): {e}")

        logger.info(f"Initialised session {sid} for '{simulation['title']}'")
        return state

    # -- Batch (non-streaming) methods ----------------------------------------

    def invoke_turn(
        self,
        state: ConversationState,
        user_message: str,
    ) -> ConversationState:
        """Run a user-message turn through the graph (batch)."""
        state["user_message"] = user_message
        state["proactive_trigger"] = None
        logger.info(f"invoke_turn: {user_message[:80]}...")
        return self._graph.invoke(state)

    def invoke_proactive(
        self,
        state: ConversationState,
        trigger_type: Literal["start", "inactivity", "followup"],
    ) -> ConversationState:
        """Run a proactive trigger through the graph (batch)."""
        state["proactive_trigger"] = trigger_type
        state["user_message"] = None
        if trigger_type == "start":
            state["proactive_count"] = 0
        logger.info(f"invoke_proactive: {trigger_type}")
        return self._graph.invoke(state)

    # -- Streaming methods ----------------------------------------------------

    def stream_turn(
        self,
        state: ConversationState,
        user_message: str,
    ) -> Generator[MessageEvent, None, None]:
        """Stream a user-message turn, yielding a MessageEvent for each AI message."""
        state["user_message"] = user_message
        state["proactive_trigger"] = None
        logger.info(f"stream_turn: {user_message[:80]}...")
        yield from self._stream_graph(state)

    def stream_proactive(
        self,
        state: ConversationState,
        trigger_type: Literal["start", "inactivity", "followup"],
    ) -> Generator[MessageEvent, None, None]:
        """Stream a proactive trigger, yielding a MessageEvent per AI message."""
        state["proactive_trigger"] = trigger_type
        state["user_message"] = None
        if trigger_type == "start":
            state["proactive_count"] = 0
        logger.info(f"stream_proactive: {trigger_type}")
        yield from self._stream_graph(state)

    def _stream_graph(
        self,
        state: ConversationState,
    ) -> Generator[MessageEvent, None, None]:
        """Run graph.stream() and yield a MessageEvent after every node that
        produces a new AI message (generate_response / generate_proactive).

        We accumulate state across all node updates so that each yielded
        ``MessageEvent.state`` reflects the full conversation history up to
        that point, not just the latest node's partial output.
        """
        wpm = get_typing_wpm(state)
        is_first_ai = True
        ai_index = 0

        # Running snapshot — starts from the input state and is progressively
        # patched with every node update we receive.
        accumulated = dict(state)
        accumulated["messages"] = list(state.get("messages", []))

        for chunk in self._graph.stream(state, stream_mode="updates"):
            for node_name, node_output in chunk.items():
                # Merge ALL node outputs into the running snapshot so
                # non-message fields (goal_progress, analysis, etc.) stay current.
                for key, value in node_output.items():
                    if key == "messages":
                        accumulated["messages"] = add_messages(accumulated["messages"], value)
                    else:
                        accumulated[key] = value

                if node_name not in _MESSAGE_NODES:
                    continue

                new_messages = node_output.get("messages", [])
                for msg in new_messages:
                    if not isinstance(msg, AIMessage):
                        continue

                    content = str(msg.content)
                    delay = 0.0 if is_first_ai else compute_typing_delay(content, wpm)
                    is_first_ai = False

                    yield MessageEvent(
                        content=content,
                        node=node_name,
                        typing_delay_sec=delay,
                        message_index=ai_index,
                        is_followup=(node_name == "generate_proactive"),
                        state=dict(accumulated),
                    )
                    ai_index += 1

        # Yield a final event carrying the complete post-graph state so that
        # callers pick up updates from non-message nodes (goal evaluation,
        # proactive checks, analysis, etc.) that run after the last AI message.
        yield MessageEvent(
            content="",
            node="__done__",
            typing_delay_sec=0.0,
            message_index=ai_index,
            is_followup=False,
            is_final=True,
            state=dict(accumulated),
        )

    # -- Catalogue ------------------------------------------------------------

    def list_simulations(self) -> list[dict[str, str]]:
        """Return available simulations (slug, title, persona name)."""
        return [
            {
                "slug": s["slug"],
                "title": s["title"],
                "persona_name": s["personaName"],
            }
            for s in list_simulations()
        ]

    def list_personas(self) -> list[dict[str, Any]]:
        """Return public-safe persona summaries.

        Sensitive roleplay fields (``personality``, ``primaryGoal``,
        ``hiddenMotivation``, ``conversationStyle``) are stripped at the
        data-loader layer so they never reach HTTP.
        """
        return [
            {
                "slug": p["slug"],
                "name": p["name"],
                "role": p["role"],
                "category": p["category"],
                "difficulty_level": p["difficultyLevel"],
            }
            for p in list_personas()
        ]


# -- Singleton access ---------------------------------------------------------

_instance: Optional[ConversationService] = None


def get_conversation_service() -> ConversationService:
    """Get (or lazily create) the singleton ConversationService."""
    global _instance
    if _instance is None:
        _instance = ConversationService()
    return _instance
