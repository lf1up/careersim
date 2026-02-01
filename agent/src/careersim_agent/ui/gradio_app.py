"""Gradio developer console for the conversation agent.

Provides both an interactive UI for development and API endpoints for
programmatic access via gradio_client.

API Endpoints (for gradio_client):
- start_session(simulation_slug: str) -> dict
- send_message(session_id: str, message: str) -> dict
- trigger_proactive(session_id: str, trigger_type: str) -> dict
- get_session_state(session_id: str) -> dict
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

import gradio as gr

from ..graph import get_graph
from ..graph.state import ConversationState, create_initial_state
from ..services import list_simulations, load_simulation

logger = logging.getLogger(__name__)


class AgentSession:
    """Manages a conversation session with the agent."""
    
    def __init__(self):
        self.state: Optional[ConversationState] = None
        self.simulation_slug: Optional[str] = None
        self.graph = None
    
    def start_session(self, simulation_slug: str) -> str:
        """Start a new session with the given simulation."""
        try:
            simulation, persona = load_simulation(simulation_slug)
            session_id = str(uuid.uuid4())[:8]
            
            self.state = create_initial_state(
                session_id=session_id,
                simulation=simulation,
                persona=persona,
            )
            self.simulation_slug = simulation_slug
            self.graph = get_graph()
            
            logger.info(f"Started session {session_id} with simulation: {simulation['title']}")
            return f"Session started: {simulation['title']} with {persona['name']}"
            
        except Exception as e:
            logger.error(f"Failed to start session: {e}")
            return f"Error: {str(e)}"
    
    def send_message(self, message: str) -> tuple[list[dict], str]:
        """Send a user message and get AI response.
        
        Returns:
            Tuple of (chat_history, status_message)
        """
        if not self.state or not self.graph:
            return [], "No active session. Please start a session first."
        
        try:
            # Set user message in state
            self.state["user_message"] = message
            self.state["proactive_trigger"] = None
            
            # Invoke graph
            logger.info(f"Invoking graph with message: {message[:50]}...")
            result = self.graph.invoke(self.state)
            
            # Update state
            self.state = result
            
            # Build chat history
            chat_history = self._build_chat_history()
            
            return chat_history, "Message processed successfully"
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            return self._build_chat_history(), f"Error: {str(e)}"
    
    def trigger_proactive(self, trigger_type: str) -> tuple[list[dict], str]:
        """Trigger a proactive message.
        
        Args:
            trigger_type: "start", "inactivity", or "followup"
        """
        if not self.state or not self.graph:
            return [], "No active session. Please start a session first."
        
        try:
            # Set proactive trigger
            self.state["proactive_trigger"] = trigger_type
            self.state["user_message"] = None
            
            # For start, reset proactive count
            if trigger_type == "start":
                self.state["proactive_count"] = 0
            
            # Invoke graph
            logger.info(f"Triggering proactive: {trigger_type}")
            result = self.graph.invoke(self.state)
            
            # Update state
            self.state = result
            
            # Build chat history
            chat_history = self._build_chat_history()
            
            return chat_history, f"Proactive {trigger_type} triggered"
            
        except Exception as e:
            logger.error(f"Error triggering proactive: {e}")
            return self._build_chat_history(), f"Error: {str(e)}"
    
    def reset_session(self) -> str:
        """Reset the current session."""
        if self.simulation_slug:
            return self.start_session(self.simulation_slug)
        
        self.state = None
        self.graph = None
        return "Session reset. Please select a simulation."
    
    def _build_chat_history(self) -> list[dict]:
        """Build chat history for Gradio chatbot.
        
        Returns messages in the new Gradio format with role/content dicts.
        """
        if not self.state:
            return []
        
        history = []
        messages = self.state.get("messages", [])
        
        for msg in messages:
            content = str(msg.content) if hasattr(msg, "content") else str(msg)
            
            # Determine message type
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
    
    def get_state_json(self) -> str:
        """Get current state as formatted JSON."""
        if not self.state:
            return "{}"
        
        # Create serializable copy
        state_copy = {}
        for key, value in self.state.items():
            if key == "messages":
                # Serialize messages
                state_copy[key] = [
                    {"type": getattr(m, "type", "unknown"), "content": str(m.content)[:200]}
                    for m in value
                ]
            elif key == "node_trace":
                state_copy[key] = value
            elif key in ("persona", "simulation"):
                # Truncate large objects
                state_copy[key] = {
                    k: v[:100] if isinstance(v, str) and len(v) > 100 else v
                    for k, v in (value or {}).items()
                    if k not in ("conversationGoals", "conversationStyle")
                }
            else:
                state_copy[key] = value
        
        return json.dumps(state_copy, indent=2, default=str)
    
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
        for entry in trace[-10:]:  # Last 10 entries
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
    
    def __init__(self):
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
        """Get a session by ID."""
        return self._sessions.get(session_id)
    
    def remove_session(self, session_id: str) -> bool:
        """Remove a session."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False


# Global session manager for API
_session_manager = SessionManager()

# Global session for UI
_session = AgentSession()


# =============================================================================
# API Functions - Called via gradio_client
# =============================================================================

def api_start_session(simulation_slug: str) -> dict:
    """Start a new conversation session.
    
    Args:
        simulation_slug: The slug identifier for the simulation
        
    Returns:
        dict with session_id, status, initial_message (if persona starts conversation),
        goal_progress, persona_name, simulation_title
    """
    try:
        session_id, session = _session_manager.create_session(simulation_slug)
        
        result = {
            "session_id": session_id,
            "status": "created",
            "simulation_title": session.state.get("simulation", {}).get("title", ""),
            "persona_name": session.state.get("persona", {}).get("name", ""),
            "goal_progress": session.get_goal_progress(),
            "messages": [],
        }
        
        # Auto-trigger start if persona starts conversation
        persona = session.state.get("persona", {})
        conv_style = persona.get("conversationStyle", {})
        if conv_style.get("startsConversation", True):
            session.state["proactive_trigger"] = "start"
            session.state["user_message"] = None
            session.state["proactive_count"] = 0
            session.state = session.graph.invoke(session.state)
            result["messages"] = session._build_chat_history()
            result["goal_progress"] = session.get_goal_progress()
        
        logger.info(f"API: Created session {session_id} for {simulation_slug}")
        return result
        
    except Exception as e:
        logger.error(f"API: Failed to create session: {e}")
        return {"error": str(e), "status": "error"}


def api_send_message(session_id: str, message: str) -> dict:
    """Send a message in an existing session.
    
    Args:
        session_id: The session identifier
        message: The user's message
        
    Returns:
        dict with messages (chat history), goal_progress, analysis, status
    """
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
    """Trigger a proactive message (start, inactivity, followup).
    
    Args:
        session_id: The session identifier
        trigger_type: One of "start", "inactivity", "followup"
        
    Returns:
        dict with messages (chat history), goal_progress, status
    """
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
    """Get the current state of a session.
    
    Args:
        session_id: The session identifier
        
    Returns:
        dict with messages, goal_progress, analysis, node_trace, full_state
    """
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
    """List all available simulations.
    
    Returns:
        dict with simulations list containing slug, title, persona_name
    """
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
    """End and cleanup a session.
    
    Args:
        session_id: The session identifier
        
    Returns:
        dict with status
    """
    try:
        if _session_manager.remove_session(session_id):
            return {"status": "ok", "message": f"Session {session_id} ended"}
        return {"error": f"Session {session_id} not found", "status": "error"}
    except Exception as e:
        logger.error(f"API: Error ending session: {e}")
        return {"error": str(e), "status": "error"}


def create_gradio_app() -> gr.Blocks:
    """Create the Gradio developer console app."""
    
    # Get available simulations
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
                # Simulation selector
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
                
                # Chat interface
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
                
                # Manual triggers
                gr.Markdown("### Manual Triggers")
                with gr.Row():
                    start_trigger_btn = gr.Button("🚀 Start")
                    inactivity_btn = gr.Button("⏰ Inactivity")
                    followup_btn = gr.Button("💬 Followup")
                    reset_btn = gr.Button("🔄 Reset", variant="stop")
            
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
        
        # Event handlers
        def on_start_session(sim_slug):
            if not sim_slug:
                return [], "Please select a simulation", [], "", "", "{}"
            
            status = _session.start_session(sim_slug)
            
            # Auto-trigger start if persona starts conversation
            if _session.state:
                persona = _session.state.get("persona", {})
                conv_style = persona.get("conversationStyle", {})
                if conv_style.get("startsConversation", True):
                    history, _ = _session.trigger_proactive("start")
                else:
                    history = []
            else:
                history = []
            
            return (
                history,
                status,
                _session.get_goal_progress(),
                _session.get_analysis_summary(),
                _session.get_node_trace(),
                _session.get_state_json(),
            )
        
        def on_send_message(message, history):
            if not message.strip():
                return history, "", _session.get_goal_progress(), _session.get_analysis_summary(), _session.get_node_trace()
            
            new_history, status = _session.send_message(message)
            return (
                new_history,
                "",  # Clear input
                _session.get_goal_progress(),
                _session.get_analysis_summary(),
                _session.get_node_trace(),
            )
        
        def on_trigger(trigger_type):
            history, status = _session.trigger_proactive(trigger_type)
            return (
                history,
                status,
                _session.get_goal_progress(),
                _session.get_analysis_summary(),
                _session.get_node_trace(),
            )
        
        def on_reset():
            status = _session.reset_session()
            return [], status, [], "No analysis available", "No trace available", "{}"
        
        # Connect events
        start_btn.click(
            on_start_session,
            inputs=[sim_dropdown],
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text, state_json],
        )
        
        send_btn.click(
            on_send_message,
            inputs=[msg_input, chatbot],
            outputs=[chatbot, msg_input, goals_table, analysis_text, trace_text],
        )
        
        msg_input.submit(
            on_send_message,
            inputs=[msg_input, chatbot],
            outputs=[chatbot, msg_input, goals_table, analysis_text, trace_text],
        )
        
        start_trigger_btn.click(
            lambda: on_trigger("start"),
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text],
        )
        
        inactivity_btn.click(
            lambda: on_trigger("inactivity"),
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text],
        )
        
        followup_btn.click(
            lambda: on_trigger("followup"),
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text],
        )
        
        reset_btn.click(
            on_reset,
            outputs=[chatbot, status_text, goals_table, analysis_text, trace_text, state_json],
        )
        
        # Refresh buttons
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
            
            # API components (hidden but accessible via client)
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
