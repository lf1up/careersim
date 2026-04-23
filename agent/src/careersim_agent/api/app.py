"""FastAPI application for production message-based communication.

The backend sends full ConversationState + a command; the agent runs the graph
and returns the updated state.  No sessions are held in memory — the backend
owns all persistence.

Two flavours per operation:
  - Batch (POST /conversation/turn)        — returns once the full graph completes.
  - Stream (POST /conversation/turn/stream) — returns Server-Sent Events as each
    AI message is generated, with typing-delay metadata so the backend can
    replay them to the frontend in real time.
"""

import hmac
import json
import logging
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import get_settings
from ..services.conversation_service import (
    ConversationService,
    MessageEvent,
    deserialize_state,
    get_conversation_service,
    serialize_state,
)

logger = logging.getLogger(__name__)


# -- Internal API authentication ---------------------------------------------

# Header used by the Node/Fastify API to authenticate itself to the agent.
# Paired with the `AGENT_INTERNAL_KEY` env var on both sides. The path is
# deliberately short + namespaced to "internal" so it's immediately obvious
# this isn't a user-facing credential.
_INTERNAL_KEY_HEADER = "X-Internal-Key"

# `/health` stays open so Docker healthchecks, load balancers, and on-call
# scripts can probe liveness without distributing the shared secret to
# infrastructure that otherwise has no reason to hold it. The endpoint
# returns a bare `{"status": "ok"}` and exposes no domain data.
_INTERNAL_KEY_EXEMPT_PATHS = frozenset({"/health"})


async def require_internal_key(
    request: Request,
    x_internal_key: Optional[str] = Header(default=None, alias=_INTERNAL_KEY_HEADER),
) -> None:
    """FastAPI dependency that gates non-exempt routes on a shared secret.

    Applied globally via ``FastAPI(dependencies=[...])`` in
    :func:`create_api_app`.  When the configured key is empty (unset
    env var) the agent runs in "dev mode" — it logs a one-line warning
    on first request and accepts everything. This keeps local `pytest`,
    the Gradio console, and single-service dev sessions trivial.

    Comparison uses :func:`hmac.compare_digest` to avoid trivially
    leaking key length / prefix via response-time side channels, even
    though this surface is intended to live on a private network.
    """
    if request.url.path in _INTERNAL_KEY_EXEMPT_PATHS:
        return

    settings = get_settings()
    expected = settings.agent_internal_key
    if not expected:
        # Don't spam the logs on every request — emit a single warning
        # the first time we notice the unset key, then stay quiet.
        if not getattr(require_internal_key, "_warned_unset", False):
            logger.warning(
                "AGENT_INTERNAL_KEY is not set — accepting all requests. "
                "Set it in production so only the API service can reach the agent."
            )
            require_internal_key._warned_unset = True  # type: ignore[attr-defined]
        return

    provided = x_internal_key or ""
    if not hmac.compare_digest(provided, expected):
        # 401 vs 403: we treat a missing/wrong key as "unauthenticated",
        # matching how we'd reject an anonymous caller at the edge.
        raise HTTPException(status_code=401, detail="Invalid or missing internal API key")


# -- Request / Response schemas -----------------------------------------------

class InitRequest(BaseModel):
    """Initialise a new conversation. The backend supplies the session_id."""
    simulation_slug: str
    session_id: Optional[str] = None


class TurnRequest(BaseModel):
    """Run one user-message turn through the graph."""
    state: dict[str, Any]
    user_message: str


class ProactiveRequest(BaseModel):
    """Trigger a proactive message (start / inactivity / followup)."""
    state: dict[str, Any]
    trigger_type: Literal["start", "inactivity", "followup"]


class ConversationResponse(BaseModel):
    """Unified response for all conversation operations."""
    state: dict[str, Any] = Field(description="Updated ConversationState (wire format)")
    messages: list[dict[str, str]] = Field(description="Flat message list for convenience")
    goal_progress: list[dict[str, Any]] = Field(default_factory=list)
    analysis: dict[str, Any] = Field(default_factory=dict)


class SimulationItem(BaseModel):
    """Summary row for the /simulations listing."""
    slug: str
    title: str
    persona_name: str
    description: Optional[str] = None
    difficulty: Optional[int] = None
    estimated_duration_minutes: Optional[int] = None
    goal_count: Optional[int] = None
    skills_to_learn: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class SimulationsResponse(BaseModel):
    simulations: list[SimulationItem]


class SimulationGoal(BaseModel):
    """Public-safe goal card (no scoring thresholds)."""
    goal_number: int
    title: str
    description: str
    key_behaviors: list[str] = Field(default_factory=list)
    success_indicators: list[str] = Field(default_factory=list)
    is_optional: bool = False


class SimulationSuccessCriteria(BaseModel):
    communication: list[str] = Field(default_factory=list)
    problem_solving: list[str] = Field(default_factory=list)
    emotional: list[str] = Field(default_factory=list)


class SimulationDetail(BaseModel):
    """Full user-facing simulation detail.

    Deliberately excludes fields that drive internal scoring or private
    persona roleplay (``evaluationConfig``, ``personality``,
    ``hiddenMotivation``, ``conversationStyle``).
    """
    slug: str
    title: str
    description: str
    scenario: str
    objectives: list[str] = Field(default_factory=list)
    persona_name: str
    persona_role: Optional[str] = None
    persona_category: Optional[str] = None
    persona_difficulty_level: Optional[int] = None
    difficulty: Optional[int] = None
    estimated_duration_minutes: Optional[int] = None
    skills_to_learn: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    success_criteria: SimulationSuccessCriteria = Field(
        default_factory=SimulationSuccessCriteria,
    )
    conversation_goals: list[SimulationGoal] = Field(default_factory=list)


class PersonaItem(BaseModel):
    """Public-safe persona summary (no internal roleplay fields)."""
    slug: str
    name: str
    role: str
    category: str
    difficulty_level: int


class PersonasResponse(BaseModel):
    personas: list[PersonaItem]


# -- Helpers ------------------------------------------------------------------

def _build_response(svc_state: dict) -> ConversationResponse:
    """Build a ConversationResponse from the post-graph ConversationState."""
    wire = serialize_state(svc_state)
    return ConversationResponse(
        state=wire,
        messages=wire.get("messages", []),
        goal_progress=wire.get("goal_progress", []),
        analysis={
            "user_sentiment": wire.get("last_user_sentiment"),
            "user_emotion": wire.get("last_user_emotion"),
            "ai_sentiment": wire.get("last_ai_sentiment"),
            "ai_emotion": wire.get("last_ai_emotion"),
        },
    )


def _sse_event(event_type: str, data: dict) -> str:
    """Format a single Server-Sent Event."""
    payload = json.dumps(data, default=str)
    return f"event: {event_type}\ndata: {payload}\n\n"


def _message_event_to_sse(event: MessageEvent) -> str:
    """Convert a MessageEvent into an SSE 'message' event."""
    return _sse_event("message", {
        "content": event.content,
        "node": event.node,
        "typing_delay_sec": round(event.typing_delay_sec, 2),
        "message_index": event.message_index,
        "is_followup": event.is_followup,
        "goal_progress": event.state.get("goal_progress", []),
        "analysis": {
            "user_sentiment": event.state.get("last_user_sentiment"),
            "user_emotion": event.state.get("last_user_emotion"),
            "ai_sentiment": event.state.get("last_ai_sentiment"),
            "ai_emotion": event.state.get("last_ai_emotion"),
        },
    })


def _done_event_to_sse(state: dict) -> str:
    """Final SSE event with the complete updated state."""
    wire = serialize_state(state)
    return _sse_event("done", {
        "state": wire,
        "messages": wire.get("messages", []),
        "goal_progress": wire.get("goal_progress", []),
    })


# -- App factory --------------------------------------------------------------

def create_api_app() -> FastAPI:
    app = FastAPI(
        title="CareerSIM Agent API",
        description="Stateless, message-based conversation agent",
        version="0.1.0",
        # Global dependency: every route except `/health` requires a
        # matching `X-Internal-Key` header when the agent is configured
        # with a non-empty `AGENT_INTERNAL_KEY`. See
        # `require_internal_key` above for the dev-mode fallback.
        dependencies=[Depends(require_internal_key)],
    )

    # -- Health & catalogue ---------------------------------------------------

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/simulations", response_model=SimulationsResponse)
    async def list_simulations():
        svc = get_conversation_service()
        return SimulationsResponse(
            simulations=[SimulationItem(**s) for s in svc.list_simulations()],
        )

    @app.get("/simulations/{slug}", response_model=SimulationDetail)
    async def get_simulation(slug: str):
        """Return the full user-facing detail for a single simulation."""
        svc = get_conversation_service()
        try:
            return SimulationDetail(**svc.get_simulation(slug))
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @app.get("/personas", response_model=PersonasResponse)
    async def list_personas():
        svc = get_conversation_service()
        return PersonasResponse(
            personas=[PersonaItem(**p) for p in svc.list_personas()],
        )

    # -- Batch endpoints (return full result at once) -------------------------

    @app.post("/conversation/init", response_model=ConversationResponse)
    async def conversation_init(req: InitRequest):
        """Create initial state, optionally with the opening AI message."""
        try:
            svc = get_conversation_service()
            state = svc.init_session(
                simulation_slug=req.simulation_slug,
                session_id=req.session_id,
            )
            # `create_initial_state` already resolved "sometimes" into a
            # concrete start decision and stored it on the state.
            if state.get("proactive_trigger") == "start":
                state = svc.invoke_proactive(state, "start")
            return _build_response(state)
        except Exception as e:
            logger.error(f"conversation/init failed: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/conversation/turn", response_model=ConversationResponse)
    async def conversation_turn(req: TurnRequest):
        """Process one user-message turn (batch)."""
        try:
            svc = get_conversation_service()
            state = deserialize_state(req.state)
            state = svc.invoke_turn(state, req.user_message)
            return _build_response(state)
        except Exception as e:
            logger.error(f"conversation/turn failed: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/conversation/proactive", response_model=ConversationResponse)
    async def conversation_proactive(req: ProactiveRequest):
        """Trigger a proactive message (batch)."""
        try:
            svc = get_conversation_service()
            state = deserialize_state(req.state)
            state = svc.invoke_proactive(state, req.trigger_type)
            return _build_response(state)
        except Exception as e:
            logger.error(f"conversation/proactive failed: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    # -- SSE streaming endpoints ----------------------------------------------

    @app.post("/conversation/init/stream")
    async def conversation_init_stream(req: InitRequest):
        """Stream the opening message(s) as SSE events."""
        try:
            svc = get_conversation_service()
            state = svc.init_session(
                simulation_slug=req.simulation_slug,
                session_id=req.session_id,
            )
            # See `create_initial_state`: "sometimes" is resolved once at
            # init and surfaced as `proactive_trigger == "start"`.
            starts = state.get("proactive_trigger") == "start"

            def generate():
                nonlocal state
                if starts:
                    last_state = state
                    for event in svc.stream_proactive(state, "start"):
                        last_state = event.state
                        if not event.is_final:
                            yield _message_event_to_sse(event)
                    yield _done_event_to_sse(last_state)
                else:
                    yield _done_event_to_sse(state)

            return StreamingResponse(generate(), media_type="text/event-stream")
        except Exception as e:
            logger.error(f"conversation/init/stream failed: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/conversation/turn/stream")
    async def conversation_turn_stream(req: TurnRequest):
        """Stream the AI response + any follow-ups as SSE events.

        Each ``event: message`` carries one AI message with ``typing_delay_sec``
        so the backend can replay timing to the frontend. The final
        ``event: done`` carries the complete updated state.
        """
        try:
            svc = get_conversation_service()
            state = deserialize_state(req.state)

            def generate():
                last_state = state
                for event in svc.stream_turn(state, req.user_message):
                    last_state = event.state
                    if not event.is_final:
                        yield _message_event_to_sse(event)
                yield _done_event_to_sse(last_state)

            return StreamingResponse(generate(), media_type="text/event-stream")
        except Exception as e:
            logger.error(f"conversation/turn/stream failed: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/conversation/proactive/stream")
    async def conversation_proactive_stream(req: ProactiveRequest):
        """Stream proactive message(s) as SSE events."""
        try:
            svc = get_conversation_service()
            state = deserialize_state(req.state)

            def generate():
                last_state = state
                for event in svc.stream_proactive(state, req.trigger_type):
                    last_state = event.state
                    if not event.is_final:
                        yield _message_event_to_sse(event)
                yield _done_event_to_sse(last_state)

            return StreamingResponse(generate(), media_type="text/event-stream")
        except Exception as e:
            logger.error(f"conversation/proactive/stream failed: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    return app
