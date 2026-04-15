# CareerSim Agent

A standalone Python LangGraph agent with a Gradio developer UI for career simulation conversations.

## Features

- **LangGraph-based conversation flow** with persona-driven AI responses
- **LLM-based evaluation** for sentiment, emotion, and goal progress (via OPENAI_EVAL_MODEL)
- **Language-agnostic** analysis with no local GPU requirement
- **Gradio developer console** with:
  - Real-time state inspection
  - Node execution tracing
  - Goal progress dashboard
  - Manual trigger buttons (inactivity, followup)
- **API endpoints** for programmatic access via `gradio_client`

## Quick Start

### Local Development

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -e .

# Or using uv (faster)
uv venv
source .venv/bin/activate
uv sync

# Copy and configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Run the agent
python -m careersim_agent.main
```

The Gradio UI will open at http://localhost:7860

### Docker (as Core Microservice)

Run the agent as part of the cluster:

```bash
# From the project root
docker-compose -f docker-compose.local.yml up core

# Or with the full stack
docker-compose -f docker-compose.local.yml up
```

The service will be available at:
- **Internal (for backend)**: `http://core:7860`
- **External (for dev)**: `http://localhost:7860`

## API Usage (gradio_client)

Connect from the backend using `gradio_client`:

```python
from gradio_client import Client

# Connect to the core service
client = Client("http://core:7860")  # or http://localhost:7860

# List available simulations
result = client.predict(api_name="/api_list_simulations")
print(result["simulations"])

# Start a session
result = client.predict(
    simulation_slug="behavioral-interview-brenda",
    api_name="/api_start_session"
)
session_id = result["session_id"]
print(f"Started session: {session_id}")
print(f"Initial message: {result['messages']}")

# Send a message
result = client.predict(
    session_id=session_id,
    message="Hello, I'm ready for my interview.",
    api_name="/api_send_message"
)
print(f"AI response: {result['messages'][-1]}")
print(f"Goal progress: {result['goal_progress']}")

# Trigger proactive message (inactivity, followup)
result = client.predict(
    session_id=session_id,
    trigger_type="followup",
    api_name="/api_trigger_proactive"
)

# Get full session state
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

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api_list_simulations` | List all available simulations |
| `/api_start_session` | Start a new conversation session |
| `/api_send_message` | Send a user message and get AI response |
| `/api_trigger_proactive` | Trigger proactive message (start/inactivity/followup) |
| `/api_get_session_state` | Get full session state |
| `/api_end_session` | End and cleanup a session |

## Project Structure

```
agent/
├── data/
│   ├── personas.json       # Persona definitions
│   └── simulations.json    # Simulation + goals
├── src/careersim_agent/
│   ├── main.py             # Entry point
│   ├── config.py           # Settings
│   ├── graph/              # LangGraph components
│   │   ├── state.py        # State schema
│   │   ├── builder.py      # Graph construction
│   │   └── nodes/          # Node implementations
│   ├── prompts/            # Prompt templates
│   ├── services/           # Data loader, eval service
│   └── ui/                 # Gradio interface
└── tests/
```

## Configuration

Edit `data/personas.json` and `data/simulations.json` to customize personas and scenarios.

## Development

This is a lab/experimental environment designed for rapid iteration.
It can evolve into a production microservice.

Key simplifications vs production:
- JSON files instead of database
- In-memory state (no checkpointing)
- Manual triggers instead of background schedulers
