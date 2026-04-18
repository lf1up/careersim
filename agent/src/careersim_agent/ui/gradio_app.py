"""Gradio developer console for the conversation agent.

Provides both an interactive UI for development and API endpoints for
programmatic access via gradio_client.

All graph invocation is delegated to ConversationService so that the Gradio
dev-console and the production FastAPI server share the exact same logic.

Streaming: message handlers are generators that yield incremental chat history.
Follow-up messages appear one by one with a simulated typing delay derived
from the persona's ``typingSpeedWpm``.

API Endpoints (for gradio_client):
- start_session(simulation_slug: str) -> dict
- send_message(session_id: str, message: str) -> dict
- trigger_proactive(session_id: str, trigger_type: str) -> dict
- get_session_state(session_id: str) -> dict
"""

import json
import logging
import random
import threading
import time
import uuid
from typing import Any, Optional

import gradio as gr

from langchain_core.messages import AIMessage

from ..services.conversation_service import (
    ConversationService,
    MessageEvent,
    compute_typing_delay,
    get_conversation_service,
    get_typing_wpm,
    serialize_state,
)
from ..services import list_simulations
from ..graph.state import ConversationState

logger = logging.getLogger(__name__)


class AgentSession:
    """Manages a conversation session with the agent.

    Holds state in-memory (dev mode only). Delegates all graph invocation
    to the shared ConversationService.
    """

    def __init__(self) -> None:
        self.state: Optional[ConversationState] = None
        self.simulation_slug: Optional[str] = None
        self._svc: ConversationService = get_conversation_service()

        # Inactivity nudge tracking
        self._last_activity_time: float = 0.0
        self._nudge_count: int = 0
        self._next_nudge_delay: float = 60.0
        self._nudging: bool = False

    # -- Inactivity nudge helpers -----------------------------------------------

    def _reset_activity(self) -> None:
        """Reset the inactivity timer. Called after any user interaction."""
        self._last_activity_time = time.time()
        self._nudge_count = 0
        self._pick_nudge_delay()

    def _pick_nudge_delay(self) -> None:
        """Pick a random delay for the next inactivity nudge from persona config."""
        if not self.state:
            self._next_nudge_delay = 60.0
            return
        style = self.state.get("persona", {}).get("conversationStyle", {})
        cfg = style.get("inactivityNudgeDelaySec", {"min": 60, "max": 180})
        self._next_nudge_delay = random.uniform(cfg.get("min", 60), cfg.get("max", 180))

    def _get_max_nudges(self) -> int:
        if not self.state:
            return 0
        style = self.state.get("persona", {}).get("conversationStyle", {})
        cfg = style.get("inactivityNudges", {"min": 0, "max": 2})
        return cfg.get("max", 2)

    def should_nudge(self) -> bool:
        """Check whether an inactivity nudge should fire right now."""
        if not self.state or self._last_activity_time == 0.0:
            return False
        if self._nudging:
            return False
        if self._nudge_count >= self._get_max_nudges():
            return False
        return (time.time() - self._last_activity_time) >= self._next_nudge_delay

    def stream_inactivity_nudge(self, delay_enabled: bool = True):
        """Generator: fire an inactivity nudge if conditions are met.

        Yields (chat_history, status) tuples just like the other streaming
        methods so it plugs directly into the Timer tick handler.
        """
        if not self.should_nudge():
            return

        self._nudging = True
        try:
            self._nudge_count += 1
            self._last_activity_time = time.time()
            self._pick_nudge_delay()

            yield from self.stream_proactive("inactivity", delay_enabled)
        finally:
            self._nudging = False

    def start_session(self, simulation_slug: str) -> str:
        """Start a new session with the given simulation."""
        try:
            self.state = self._svc.init_session(simulation_slug)
            self.simulation_slug = simulation_slug
            self._reset_activity()
            sim_title = self.state.get("simulation", {}).get("title", "")
            persona_name = self.state.get("persona", {}).get("name", "")
            logger.info(f"Started session for: {sim_title}")
            return f"Session started: {sim_title} with {persona_name}"
        except Exception as e:
            logger.error(f"Failed to start session: {e}")
            return f"Error: {str(e)}"

    # -- Batch methods (used by gradio_client API functions) -------------------

    def send_message(self, message: str) -> tuple[list[dict], str]:
        """Send a user message and get AI response (batch, all at once)."""
        if not self.state:
            return [], "No active session. Please start a session first."
        try:
            self.state = self._svc.invoke_turn(self.state, message)
            return self._build_chat_history(), "Message processed successfully"
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            return self._build_chat_history(), f"Error: {str(e)}"

    def trigger_proactive(self, trigger_type: str) -> tuple[list[dict], str]:
        """Trigger a proactive message (batch, all at once)."""
        if not self.state:
            return [], "No active session. Please start a session first."
        try:
            self.state = self._svc.invoke_proactive(self.state, trigger_type)  # type: ignore[arg-type]
            return self._build_chat_history(), f"Proactive {trigger_type} triggered"
        except Exception as e:
            logger.error(f"Error triggering proactive: {e}")
            return self._build_chat_history(), f"Error: {str(e)}"

    # -- Streaming methods (used by interactive Gradio UI) --------------------

    def stream_send_message(self, message: str, delay_enabled: bool = True):
        """Run the full graph (batch), then yield new AI messages one-by-one.

        Using batch invocation guarantees the entire graph runs to completion
        (including evaluate_goals, check_proactive, and follow-up generation)
        regardless of Gradio event cancellation from Timer ticks, etc.
        """
        if not self.state:
            yield [], "No active session. Please start a session first."
            return
        self._reset_activity()
        try:
            msg_before = len(self.state.get("messages", []))
            self.state = self._svc.invoke_turn(self.state, message)
            yield from self._yield_new_messages(msg_before, delay_enabled)
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            yield self._build_chat_history(), f"Error: {str(e)}"

    def stream_proactive(self, trigger_type: str, delay_enabled: bool = True):
        """Run the full proactive graph (batch), then yield new AI messages."""
        if not self.state:
            yield [], "No active session. Please start a session first."
            return
        try:
            msg_before = len(self.state.get("messages", []))
            self.state = self._svc.invoke_proactive(self.state, trigger_type)  # type: ignore[arg-type]
            yield from self._yield_new_messages(msg_before, delay_enabled,
                                                label=f"Proactive {trigger_type}")
        except Exception as e:
            logger.error(f"Error triggering proactive: {e}")
            yield self._build_chat_history(), f"Error: {str(e)}"

    def _yield_new_messages(
        self,
        msg_before: int,
        delay_enabled: bool,
        label: str = "Message",
    ):
        """Yield (chat_history, status) for each new AI message after a batch invoke.

        Messages are displayed incrementally with per-persona typing delays.
        """
        all_msgs = self.state.get("messages", [])
        wpm = get_typing_wpm(self.state)
        is_first_ai = True
        ai_count = 0

        _MIN_FOLLOWUP_DELAY = 0.5

        for i in range(msg_before, len(all_msgs)):
            msg = all_msgs[i]
            if not isinstance(msg, AIMessage):
                continue
            ai_count += 1
            if not is_first_ai:
                if delay_enabled:
                    delay = compute_typing_delay(str(msg.content), wpm)
                else:
                    delay = _MIN_FOLLOWUP_DELAY
                time.sleep(delay)
            is_first_ai = False
            yield (
                self._messages_to_history(all_msgs[: i + 1]),
                f"{label} {ai_count} received",
            )

        yield self._build_chat_history(), f"{label} processed successfully"

    def reset_session(self) -> str:
        """Reset the current session."""
        if self.simulation_slug:
            return self.start_session(self.simulation_slug)
        self.state = None
        return "Session reset. Please select a simulation."

    # -- Display helpers (Gradio-specific formatting) -------------------------

    @staticmethod
    def _messages_to_history(messages: list) -> list[dict]:
        """Convert a list of LangChain messages to Gradio chat format."""
        history: list[dict] = []
        for msg in messages:
            content = str(msg.content) if hasattr(msg, "content") else str(msg)
            if hasattr(msg, "type"):
                msg_type = msg.type
            elif hasattr(msg, "_type"):
                msg_type = msg._type
            else:
                msg_type = "unknown"
            if msg_type == "human":
                history.append({"role": "user", "content": content})
            elif msg_type == "ai":
                history.append({"role": "assistant", "content": content})
        return history

    def _build_chat_history(self) -> list[dict]:
        """Build chat history for Gradio chatbot from current state."""
        if not self.state:
            return []
        return self._messages_to_history(self.state.get("messages", []))

    def get_state_json(self) -> str:
        """Get current state as formatted JSON."""
        if not self.state:
            return "{}"
        wire = serialize_state(self.state)
        for key in ("persona", "simulation"):
            if key in wire and isinstance(wire[key], dict):
                wire[key] = {
                    k: v[:100] if isinstance(v, str) and len(v) > 100 else v
                    for k, v in wire[key].items()
                    if k not in ("conversationGoals", "conversationStyle")
                }
        for m in wire.get("messages", []):
            m["content"] = m["content"][:200]
        return json.dumps(wire, indent=2, default=str)

    def get_goal_progress(self) -> list[list]:
        """Get goal progress as table data."""
        if not self.state:
            return []
        rows = []
        for progress in self.state.get("goal_progress", []):
            status = progress.get("status", "not_started")
            status_emoji = {
                "not_started": "⬜",
                "in_progress": "🔄",
                "achieved": "✅",
            }.get(status, "❓")
            rows.append([
                progress.get("goalNumber", 0),
                f"{status_emoji} {progress.get('title', 'Unknown')}",
                status,
                f"{progress.get('confidence', 0):.2f}",
                len(progress.get("evidence", [])),
            ])
        return rows

    def get_node_trace(self) -> str:
        """Get node execution trace."""
        if not self.state:
            return "No trace available"
        trace = self.state.get("node_trace", [])
        if not trace:
            return "No trace entries"
        lines = []
        for entry in trace[-10:]:
            lines.append(
                f"[{entry.get('timestamp', '')[:19]}] "
                f"{entry.get('node', 'unknown')} "
                f"({entry.get('duration_ms', 0):.1f}ms)\n"
                f"  in: {entry.get('input_summary', '')}\n"
                f"  out: {entry.get('output_summary', '')}"
            )
        return "\n\n".join(lines)

    def get_analysis_summary(self) -> str:
        """Get analysis results summary."""
        if not self.state:
            return "No analysis available"
        lines = []
        user_sentiment = self.state.get("last_user_sentiment")
        user_emotion = self.state.get("last_user_emotion")
        if user_sentiment or user_emotion:
            lines.append("**User Message Analysis:**")
            if user_sentiment:
                lines.append(f"  Sentiment: {user_sentiment.get('label', 'N/A')} ({user_sentiment.get('confidence', 0):.2f})")
            if user_emotion:
                lines.append(f"  Emotion: {user_emotion.get('label', 'N/A')} ({user_emotion.get('confidence', 0):.2f})")
        ai_sentiment = self.state.get("last_ai_sentiment")
        ai_emotion = self.state.get("last_ai_emotion")
        if ai_sentiment or ai_emotion:
            lines.append("\n**AI Response Analysis:**")
            if ai_sentiment:
                lines.append(f"  Sentiment: {ai_sentiment.get('label', 'N/A')} ({ai_sentiment.get('confidence', 0):.2f})")
            if ai_emotion:
                lines.append(f"  Emotion: {ai_emotion.get('label', 'N/A')} ({ai_emotion.get('confidence', 0):.2f})")
        return "\n".join(lines) if lines else "No analysis data"


# =============================================================================
# Session Manager - Manages multiple concurrent sessions for API use
# =============================================================================

class SessionManager:
    """Manages multiple conversation sessions for API access."""

    def __init__(self) -> None:
        self._sessions: dict[str, AgentSession] = {}

    def create_session(self, simulation_slug: str) -> tuple[str, AgentSession]:
        """Create a new session and return its ID."""
        session = AgentSession()
        status = session.start_session(simulation_slug)
        if session.state:
            session_id = session.state.get("session_id", str(uuid.uuid4())[:8])
            self._sessions[session_id] = session
            return session_id, session
        raise ValueError(status)

    def get_session(self, session_id: str) -> Optional[AgentSession]:
        return self._sessions.get(session_id)

    def remove_session(self, session_id: str) -> bool:
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False


# Global session manager for API
_session_manager = SessionManager()

# Global session for UI
_session = AgentSession()


# =============================================================================
# API Functions - Called via gradio_client (batch, non-streaming)
# =============================================================================

def api_start_session(simulation_slug: str) -> dict:
    """Start a new conversation session."""
    try:
        session_id, session = _session_manager.create_session(simulation_slug)
        result: dict[str, Any] = {
            "session_id": session_id,
            "status": "created",
            "simulation_title": session.state.get("simulation", {}).get("title", ""),
            "persona_name": session.state.get("persona", {}).get("name", ""),
            "goal_progress": session.get_goal_progress(),
            "messages": [],
        }
        persona = session.state.get("persona", {})
        conv_style = persona.get("conversationStyle", {})
        if conv_style.get("startsConversation", True):
            session.trigger_proactive("start")
            result["messages"] = session._build_chat_history()
            result["goal_progress"] = session.get_goal_progress()
        logger.info(f"API: Created session {session_id} for {simulation_slug}")
        return result
    except Exception as e:
        logger.error(f"API: Failed to create session: {e}")
        return {"error": str(e), "status": "error"}


def api_send_message(session_id: str, message: str) -> dict:
    """Send a message in an existing session."""
    try:
        session = _session_manager.get_session(session_id)
        if not session:
            return {"error": f"Session {session_id} not found", "status": "error"}
        history, status = session.send_message(message)
        return {
            "status": "ok",
            "messages": history,
            "goal_progress": session.get_goal_progress(),
            "analysis": {
                "user_sentiment": session.state.get("last_user_sentiment"),
                "user_emotion": session.state.get("last_user_emotion"),
                "ai_sentiment": session.state.get("last_ai_sentiment"),
                "ai_emotion": session.state.get("last_ai_emotion"),
            },
        }
    except Exception as e:
        logger.error(f"API: Error in send_message: {e}")
        return {"error": str(e), "status": "error"}


def api_trigger_proactive(session_id: str, trigger_type: str) -> dict:
    """Trigger a proactive message (start, inactivity, followup)."""
    try:
        session = _session_manager.get_session(session_id)
        if not session:
            return {"error": f"Session {session_id} not found", "status": "error"}
        if trigger_type not in ("start", "inactivity", "followup"):
            return {"error": f"Invalid trigger_type: {trigger_type}", "status": "error"}
        history, status = session.trigger_proactive(trigger_type)
        return {
            "status": "ok",
            "trigger_type": trigger_type,
            "messages": history,
            "goal_progress": session.get_goal_progress(),
        }
    except Exception as e:
        logger.error(f"API: Error in trigger_proactive: {e}")
        return {"error": str(e), "status": "error"}


def api_get_session_state(session_id: str) -> dict:
    """Get the current state of a session."""
    try:
        session = _session_manager.get_session(session_id)
        if not session:
            return {"error": f"Session {session_id} not found", "status": "error"}
        return {
            "status": "ok",
            "session_id": session_id,
            "messages": session._build_chat_history(),
            "goal_progress": session.get_goal_progress(),
            "analysis": session.get_analysis_summary(),
            "node_trace": session.get_node_trace(),
            "state_json": session.get_state_json(),
        }
    except Exception as e:
        logger.error(f"API: Error in get_session_state: {e}")
        return {"error": str(e), "status": "error"}


def api_list_simulations() -> dict:
    """List all available simulations."""
    try:
        simulations = list_simulations()
        return {
            "status": "ok",
            "simulations": [
                {
                    "slug": s["slug"],
                    "title": s["title"],
                    "persona_name": s["personaName"],
                }
                for s in simulations
            ],
        }
    except Exception as e:
        logger.error(f"API: Error listing simulations: {e}")
        return {"error": str(e), "status": "error"}


def api_end_session(session_id: str) -> dict:
    """End and cleanup a session."""
    try:
        if _session_manager.remove_session(session_id):
            return {"status": "ok", "message": f"Session {session_id} ended"}
        return {"error": f"Session {session_id} not found", "status": "error"}
    except Exception as e:
        logger.error(f"API: Error ending session: {e}")
        return {"error": str(e), "status": "error"}


# =============================================================================
# Gradio UI
# =============================================================================

def create_gradio_app() -> gr.Blocks:
    """Create the Gradio developer console app."""

    simulations = list_simulations()
    sim_choices = [(f"{s['title']} ({s['personaName']})", s['slug']) for s in simulations]

    with gr.Blocks(
        title="CareerSim Agent - Developer Console",
    ) as app:
        gr.Markdown("# CareerSim Agent - Developer Console")
        gr.Markdown("Debug and test the conversation agent with full state visibility.")

        with gr.Row():
            # Left column: Chat interface
            with gr.Column(scale=2):
                with gr.Row():
                    sim_dropdown = gr.Dropdown(
                        choices=sim_choices,
                        label="Select Simulation",
                        interactive=True,
                    )
                    start_btn = gr.Button("Start Session", variant="primary")

                status_text = gr.Textbox(
                    label="Status",
                    interactive=False,
                    lines=1,
                )

                chatbot = gr.Chatbot(
                    label="Conversation",
                    height=400,
                )

                with gr.Row():
                    msg_input = gr.Textbox(
                        label="Your Message",
                        placeholder="Type your message here...",
                        lines=2,
                        scale=4,
                    )
                    send_btn = gr.Button("Send", variant="primary", scale=1)

                gr.Markdown("### Manual Triggers")
                with gr.Row():
                    start_trigger_btn = gr.Button("🚀 Start")
                    inactivity_btn = gr.Button("⏰ Inactivity")
                    followup_btn = gr.Button("💬 Followup")
                    reset_btn = gr.Button("🔄 Reset", variant="stop")
                with gr.Row():
                    typing_delay_cb = gr.Checkbox(
                        label="Simulate typing delay",
                        value=False,
                    )
                    inactivity_cb = gr.Checkbox(
                        label="Auto inactivity nudges",
                        value=False,
                    )
                inactivity_timer = gr.Timer(value=5, active=False)

            # Right column: Debug panels
            with gr.Column(scale=1):
                with gr.Accordion("Goal Progress", open=True):
                    goals_table = gr.Dataframe(
                        headers=["#", "Goal", "Status", "Confidence", "Evidence"],
                        datatype=["number", "str", "str", "str", "number"],
                        interactive=False,
                    )
                    refresh_goals_btn = gr.Button("Refresh Goals", size="sm")

                with gr.Accordion("Analysis", open=True):
                    analysis_text = gr.Markdown("No analysis available")
                    refresh_analysis_btn = gr.Button("Refresh Analysis", size="sm")

                with gr.Accordion("Node Trace", open=False):
                    trace_text = gr.Textbox(
                        label="Execution Trace",
                        lines=15,
                        interactive=False,
                    )
                    refresh_trace_btn = gr.Button("Refresh Trace", size="sm")

                with gr.Accordion("State Inspector", open=False):
                    state_json = gr.Code(
                        label="Current State",
                        language="json",
                        lines=20,
                    )
                    refresh_state_btn = gr.Button("Refresh State", size="sm")

        # -- Streaming event handlers -----------------------------------------

        def on_start_session(sim_slug, delay_enabled):
            """Start session, then stream the opening message(s) with optional delay."""
            if not sim_slug:
                yield [], "Please select a simulation", [], "", "", "{}"
                return

            status = _session.start_session(sim_slug)
            if not _session.state:
                yield [], status, [], "", "", "{}"
                return

            persona = _session.state.get("persona", {})
            conv_style = persona.get("conversationStyle", {})

            if conv_style.get("startsConversation", True):
                for history, msg_status in _session.stream_proactive("start", delay_enabled):
                    yield (
                        history,
                        msg_status,
                        _session.get_goal_progress(),
                        _session.get_analysis_summary(),
                        _session.get_node_trace(),
                        _session.get_state_json(),
                    )
            else:
                yield (
                    [],
                    status,
                    _session.get_goal_progress(),
                    _session.get_analysis_summary(),
                    _session.get_node_trace(),
                    _session.get_state_json(),
                )

        def on_send_message(message, history, delay_enabled):
            """Stream AI response + follow-ups one by one with optional typing delay."""
            if not message.strip():
                yield history, "", _session.get_goal_progress(), _session.get_analysis_summary(), _session.get_node_trace()
                return

            for new_history, msg_status in _session.stream_send_message(message, delay_enabled):
                yield (
                    new_history,
                    "",
                    _session.get_goal_progress(),
                    _session.get_analysis_summary(),
                    _session.get_node_trace(),
                )

        def on_trigger(trigger_type, delay_enabled):
            """Stream proactive messages one by one with optional typing delay."""
            for history, msg_status in _session.stream_proactive(trigger_type, delay_enabled):
                yield (
                    history,
                    msg_status,
                    _session.get_goal_progress(),
                    _session.get_analysis_summary(),
                    _session.get_node_trace(),
                )

        def on_inactivity_tick(delay_enabled):
            """Timer tick: fire an inactivity nudge if conditions are met."""
            nudged = False
            for history, msg_status in _session.stream_inactivity_nudge(delay_enabled):
                nudged = True
                yield (
                    history,
                    msg_status,
                    _session.get_goal_progress(),
                    _session.get_analysis_summary(),
                    _session.get_node_trace(),
                )
            if not nudged:
                skip = gr.skip()
                yield (skip, skip, skip, skip, skip)

        def on_toggle_inactivity(enabled):
            """Enable/disable the inactivity timer. Resets the activity clock."""
            if enabled and _session.state:
                _session._reset_activity()
            return gr.Timer(active=enabled)

        def on_reset():
            status = _session.reset_session()
            return [], status, [], "No analysis available", "No trace available", "{}"

        # Connect events
        start_btn.click(
            on_start_session,
            inputs=[sim_dropdown, typing_delay_cb],
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text, state_json],
        )

        send_btn.click(
            on_send_message,
            inputs=[msg_input, chatbot, typing_delay_cb],
            outputs=[chatbot, msg_input, goals_table, analysis_text, trace_text],
        )

        msg_input.submit(
            on_send_message,
            inputs=[msg_input, chatbot, typing_delay_cb],
            outputs=[chatbot, msg_input, goals_table, analysis_text, trace_text],
        )

        start_trigger_btn.click(
            lambda delay: on_trigger("start", delay),
            inputs=[typing_delay_cb],
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text],
        )

        inactivity_btn.click(
            lambda delay: on_trigger("inactivity", delay),
            inputs=[typing_delay_cb],
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text],
        )

        followup_btn.click(
            lambda delay: on_trigger("followup", delay),
            inputs=[typing_delay_cb],
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text],
        )

        reset_btn.click(
            on_reset,
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text, state_json],
        )

        inactivity_cb.change(
            on_toggle_inactivity,
            inputs=[inactivity_cb],
            outputs=[inactivity_timer],
        )

        inactivity_timer.tick(
            on_inactivity_tick,
            inputs=[typing_delay_cb],
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text],
        )

        refresh_goals_btn.click(
            lambda: _session.get_goal_progress(),
            outputs=[goals_table],
        )

        refresh_analysis_btn.click(
            lambda: _session.get_analysis_summary(),
            outputs=[analysis_text],
        )

        refresh_trace_btn.click(
            lambda: _session.get_node_trace(),
            outputs=[trace_text],
        )

        refresh_state_btn.click(
            lambda: _session.get_state_json(),
            outputs=[state_json],
        )

        # =================================================================
        # API Tab - Endpoints for gradio_client
        # =================================================================
        with gr.Tab("API"):
            gr.Markdown("""
            ## API Endpoints
            
            Use these endpoints with `gradio_client` from your backend:
            
            ```python
            from gradio_client import Client
            
            client = Client("http://core:7860")  # or http://localhost:7860
            
            # List available simulations
            result = client.predict(api_name="/api_list_simulations")
            
            # Start a session
            result = client.predict(
                simulation_slug="behavioral-interview-brenda",
                api_name="/api_start_session"
            )
            session_id = result["session_id"]
            
            # Send a message
            result = client.predict(
                session_id=session_id,
                message="Hello, I'm ready for my interview.",
                api_name="/api_send_message"
            )
            
            # Trigger proactive message
            result = client.predict(
                session_id=session_id,
                trigger_type="followup",
                api_name="/api_trigger_proactive"
            )
            
            # Get session state
            result = client.predict(
                session_id=session_id,
                api_name="/api_get_session_state"
            )
            
            # End session
            result = client.predict(
                session_id=session_id,
                api_name="/api_end_session"
            )
            ```
            """)

            gr.Interface(
                fn=api_list_simulations,
                inputs=[],
                outputs=gr.JSON(label="Result"),
                title="List Simulations",
                api_name="api_list_simulations",
            )

            gr.Interface(
                fn=api_start_session,
                inputs=[gr.Textbox(label="Simulation Slug")],
                outputs=gr.JSON(label="Result"),
                title="Start Session",
                api_name="api_start_session",
            )

            gr.Interface(
                fn=api_send_message,
                inputs=[
                    gr.Textbox(label="Session ID"),
                    gr.Textbox(label="Message"),
                ],
                outputs=gr.JSON(label="Result"),
                title="Send Message",
                api_name="api_send_message",
            )

            gr.Interface(
                fn=api_trigger_proactive,
                inputs=[
                    gr.Textbox(label="Session ID"),
                    gr.Dropdown(
                        choices=["start", "inactivity", "followup"],
                        label="Trigger Type"
                    ),
                ],
                outputs=gr.JSON(label="Result"),
                title="Trigger Proactive",
                api_name="api_trigger_proactive",
            )

            gr.Interface(
                fn=api_get_session_state,
                inputs=[gr.Textbox(label="Session ID")],
                outputs=gr.JSON(label="Result"),
                title="Get Session State",
                api_name="api_get_session_state",
            )

            gr.Interface(
                fn=api_end_session,
                inputs=[gr.Textbox(label="Session ID")],
                outputs=gr.JSON(label="Result"),
                title="End Session",
                api_name="api_end_session",
            )

    return app
