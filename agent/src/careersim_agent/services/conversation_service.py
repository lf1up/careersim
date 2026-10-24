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
from copy import deepcopy
from langgraph.graph.message import add_messages
from datetime import datetime
from typing import Any, Literal, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from ..config import get_settings
from ..graph import get_graph
from ..graph.state import ConversationState, GoalProgressItem, create_initial_state
from .data_loader import (
    get_persona_avatar_path,
    list_personas,
    list_simulations,
    load_simulation,
    load_participants,
    public_participants,
)

logger = logging.getLogger(__name__)

def serialize_message(message: BaseMessage, state: ConversationState, index: int) -> dict[str, str]:
    # Stable backfill for pre-v2 snapshots; generated graph IDs are kept verbatim.
    if not message.id:
        message.id = str(uuid.uuid5(uuid.NAMESPACE_URL, json.dumps([
            state.get("session_id", ""), index, message.type, str(message.content)])))
    persona = state.get("persona", {})
    if not message.name:
        message.name = "user" if message.type == "human" else persona.get("slug", "persona")
    name = message.additional_kwargs.get("actor_name") or (
        "You" if message.type == "human" else persona.get("name", message.name))
    return {"role": message.type, "content": str(message.content), "event_id": message.id,
            "actor_id": message.name, "actor_name": name}


def serialize_state(state: ConversationState) -> dict[str, Any]:
    return {key: [serialize_message(m, state, i) for i, m in enumerate(value)]
            if key == "messages" else value for key, value in state.items()}


def deserialize_state(data: dict[str, Any]) -> ConversationState:
    state = dict(data)
    state["messages"] = []
    for raw in data.get("messages", []):
        cls = HumanMessage if raw.get("role") == "human" else AIMessage if raw.get("role") == "ai" else None
        if cls is None:
            continue
        message = cls(content=raw.get("content", ""), id=raw.get("event_id"), name=raw.get("actor_id"),
                      additional_kwargs={"actor_name": raw["actor_name"]} if raw.get("actor_name") else {})
        serialize_message(message, state, len(state["messages"]))
        state["messages"].append(message)
    return state


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


# -- User-message input helpers ------------------------------------------------

def _normalize_user_messages(user_message: "str | list[str]") -> list[str]:
    """Coerce the single-string / list-of-strings input into a clean list."""
    if isinstance(user_message, str):
        items = [user_message]
    else:
        items = list(user_message)
    return [m.strip() for m in items if isinstance(m, str) and m.strip()]


def _preview_user_messages(user_message: "str | list[str]") -> str:
    """Short log-safe preview of a turn's user input."""
    items = _normalize_user_messages(user_message)
    joined = " | ".join(items)
    return f"{len(items)} message(s): {joined[:80]}..."


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
    event_id: Optional[str] = None
    actor_id: Optional[str] = None
    actor_name: Optional[str] = None


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
        if settings.rag_enabled and not state.get("characters"):
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
        user_message: "str | list[str]",
    ) -> ConversationState:
        """Run a user-message turn through the graph (batch).

        ``user_message`` may be a single string or a list of strings — the
        latter persists each item as its own bubble while the persona
        composes one reply to the whole batch.
        """
        state["user_message"] = None
        state["user_messages"] = _normalize_user_messages(user_message)
        state["proactive_trigger"] = None
        logger.info(f"invoke_turn: {_preview_user_messages(user_message)}")
        return self._graph.invoke(state)

    def invoke_proactive(
        self,
        state: ConversationState,
        trigger_type: Literal["start", "inactivity", "followup"],
    ) -> ConversationState:
        """Run a proactive trigger through the graph (batch)."""
        state["proactive_trigger"] = trigger_type
        state["user_message"] = None
        state["user_messages"] = None
        if trigger_type == "start":
            state["proactive_count"] = 0
        logger.info(f"invoke_proactive: {trigger_type}")
        return self._graph.invoke(state)

    # -- Streaming methods ----------------------------------------------------

    def stream_turn(
        self,
        state: ConversationState,
        user_message: "str | list[str]",
    ) -> Generator[MessageEvent, None, None]:
        """Stream a user-message turn, yielding a MessageEvent for each AI message.

        ``user_message`` may be a single string or a list of strings (one
        HumanMessage bubble per item, one composed persona reply).
        """
        state["user_message"] = None
        state["user_messages"] = _normalize_user_messages(user_message)
        state["proactive_trigger"] = None
        logger.info(f"stream_turn: {_preview_user_messages(user_message)}")
        yield from self._stream_graph(state)

    def stream_proactive(
        self,
        state: ConversationState,
        trigger_type: Literal["start", "inactivity", "followup"],
    ) -> Generator[MessageEvent, None, None]:
        """Stream a proactive trigger, yielding a MessageEvent per AI message."""
        state["proactive_trigger"] = trigger_type
        state["user_message"] = None
        state["user_messages"] = None
        if trigger_type == "start":
            state["proactive_count"] = 0
        logger.info(f"stream_proactive: {trigger_type}")
        yield from self._stream_graph(state)

    def _stream_graph(
        self,
        state: ConversationState,
    ) -> Generator[MessageEvent, None, None]:
        """Merge updates with the graph's message reducer and emit each new ID once."""
        serialize_state(state)
        accumulated = dict(state)
        accumulated["messages"] = list(state.get("messages", []))
        seen = {m.id for m in accumulated["messages"]}
        ai_index = 0
        for chunk in self._graph.stream(state, stream_mode="updates"):
            for node_name, update in chunk.items():
                for key, value in update.items():
                    accumulated[key] = add_messages(accumulated["messages"], value) if key == "messages" else value
                for index, message in enumerate(accumulated["messages"]):
                    if message.id in seen:
                        continue
                    seen.add(message.id)
                    if not isinstance(message, AIMessage):
                        continue
                    wire = serialize_message(message, accumulated, index)
                    character = accumulated.get("characters", {}).get(wire["actor_id"], {})
                    wpm = get_typing_wpm({"persona": character.get("persona", accumulated.get("persona", {}))})
                    yield MessageEvent(
                        content=wire["content"], node=node_name,
                        typing_delay_sec=0 if ai_index == 0 else compute_typing_delay(wire["content"], wpm),
                        message_index=ai_index, is_followup=node_name == "generate_proactive",
                        state=deepcopy(accumulated), event_id=wire["event_id"],
                        actor_id=wire["actor_id"], actor_name=wire["actor_name"],
                    )
                    ai_index += 1
        yield MessageEvent(content="", node="__done__", typing_delay_sec=0,
                           message_index=ai_index, is_followup=False,
                           is_final=True, state=deepcopy(accumulated))

    # -- Catalogue ------------------------------------------------------------

    def list_simulations(self) -> list[dict[str, Any]]:
        """Return available simulations with summary metadata.

        Includes enough detail for the client list view (difficulty,
        estimated duration, skills, tags, goal count) without leaking
        internal scoring thresholds or private persona fields.
        """
        summaries = list_simulations()
        out: list[dict[str, Any]] = []
        for s in summaries:
            persona_slug = s.get("personaSlug")
            out.append({
                "slug": s["slug"],
                "title": s["title"],
                "participants": s.get("participants", []),
                "persona_name": s.get("personaName", "Unknown"),
                "persona_slug": persona_slug,
                "avatar_url": (
                    f"/personas/{persona_slug}/avatar"
                    if isinstance(persona_slug, str) and get_persona_avatar_path(persona_slug)
                    else None
                ),
                "description": s.get("description"),
                "difficulty": s.get("difficulty"),
                "estimated_duration_minutes": s.get("estimatedDurationMinutes"),
                "goal_count": s.get("goalCount"),
                "skills_to_learn": list(s.get("skillsToLearn", []) or []),
                "tags": list(s.get("tags", []) or []),
            })
        return out

    def get_simulation(self, slug: str) -> dict[str, Any]:
        """Return a public-safe detail record for a single simulation.

        Strips internal scoring config (``evaluationConfig``) and private
        persona roleplay fields — only the persona's name, role, category
        and difficulty level are forwarded.
        """
        sim, persona = load_simulation(slug)
        cast = load_participants(sim)

        goals: list[dict[str, Any]] = []
        for g in sim.get("conversationGoals", []) or []:
            goals.append({
                "goal_number": g.get("goalNumber", 0),
                "title": g.get("title", ""),
                "description": g.get("description", ""),
                "key_behaviors": list(g.get("keyBehaviors", []) or []),
                "success_indicators": list(g.get("successIndicators", []) or []),
                "is_optional": bool(g.get("isOptional", False)),
            })

        success_criteria_raw = sim.get("successCriteria", {}) or {}
        success_criteria = {
            "communication": list(success_criteria_raw.get("communication", []) or []),
            "problem_solving": list(success_criteria_raw.get("problemSolving", []) or []),
            "emotional": list(success_criteria_raw.get("emotional", []) or []),
        }

        return {
            "slug": sim["slug"],
            "title": sim["title"],
            "description": sim.get("description", ""),
            "scenario": sim.get("scenario", ""),
            "objectives": list(sim.get("objectives", []) or []),
            "participants": public_participants(cast),
            "persona_name": " & ".join(c["persona"]["name"] for c in cast.values()) if cast else persona.get("name", "Unknown"),
            "persona_slug": persona.get("slug"),
            "avatar_url": (
                f"/personas/{persona.get('slug')}/avatar"
                if isinstance(persona.get("slug"), str)
                and get_persona_avatar_path(persona.get("slug"))
                else None
            ),
            "persona_role": persona.get("role"),
            "persona_category": persona.get("category"),
            "persona_difficulty_level": persona.get("difficultyLevel"),
            "difficulty": sim.get("difficulty"),
            "estimated_duration_minutes": sim.get("estimatedDurationMinutes"),
            "skills_to_learn": list(sim.get("skillsToLearn", []) or []),
            "tags": list(sim.get("tags", []) or []),
            "success_criteria": success_criteria,
            "conversation_goals": goals,
        }

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
                "avatar_url": (
                    f"/personas/{p['slug']}/avatar"
                    if get_persona_avatar_path(p["slug"])
                    else None
                ),
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
