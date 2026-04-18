# CareerSim Agent

A standalone Python LangGraph agent for career-simulation conversations. Ships
with a Gradio developer console **and** a stateless FastAPI production server.

## Features

- **LangGraph conversation flow** with persona-driven AI responses,
  configurable via `data/personas.json` + `data/simulations.json`.
- **LLM-based evaluation** for user/AI sentiment + emotion and per-goal
  progress tracking, using a separate (cheaper) eval model configurable via
  `OPENAI_EVAL_MODEL`.
- **Retrieval-Augmented Generation (RAG)** using Chroma + OpenAI embeddings,
  indexing per-simulation and per-persona Markdown documents from
  `data/documents/`.
- **Proactive messaging** — start, inactivity, and follow-up bursts are
  modelled as explicit graph branches.
- **Two run modes from one binary:**
  - Gradio developer console (default) — state inspector, node tracing, goal
    dashboard, manual proactive triggers.
  - FastAPI production server (`--serve api`) — stateless JSON API with both
    batch and Server-Sent Events streaming endpoints.

## Quick Start

```bash
# From agent/

# Create venv and install with uv (recommended)
uv venv
source .venv/bin/activate
uv sync

# Or plain pip
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

# Configure
cp .env.example .env
# Edit .env and set at least OPENAI_API_KEY

# Gradio dev console (default, port 7860)
python -m careersim_agent.main

# FastAPI production server (port 8000)
python -m careersim_agent.main --serve api
```

Useful flags:

| Flag | Default | Notes |
| --- | --- | --- |
| `--serve gradio\|api` | `gradio` | Selects which server to run |
| `--host` | `0.0.0.0` | API-mode bind host |
| `--port` | `7860` (gradio) / `8000` (api) | Server port |

Interactive API docs (Swagger UI) are available at `http://<host>:<port>/docs`
when running in API mode.

## Production API (`--serve api`)

The server is fully **stateless** — the backend sends the full
`ConversationState` + a command on every request, the graph runs, and the
updated state is returned. No sessions are held in memory on the agent.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe (`{"status":"ok"}`). |
| GET | `/simulations` | List available simulations (slug, title, persona). |
| POST | `/conversation/init` | Create initial state; optionally run the persona's opening proactive message. |
| POST | `/conversation/turn` | Run one user-message turn (batch). |
| POST | `/conversation/proactive` | Trigger a proactive message: `start` / `inactivity` / `followup` (batch). |
| POST | `/conversation/init/stream` | SSE variant of `init`. |
| POST | `/conversation/turn/stream` | SSE variant of `turn`. |
| POST | `/conversation/proactive/stream` | SSE variant of `proactive`. |

Batch responses share a common shape:

```json
{
  "state":          { "...full ConversationState (wire format)..." },
  "messages":       [{"role": "human|ai", "content": "..."}],
  "goal_progress":  [{ "goalNumber": 1, "status": "in_progress", "...": "..." }],
  "analysis":       { "user_sentiment": "...", "user_emotion": "...",
                      "ai_sentiment": "...",   "ai_emotion": "..." }
}
```

SSE endpoints emit one `event: message` per generated AI message (with a
persona-aware `typing_delay_sec` for realistic replay on the frontend) and a
final `event: done` carrying the complete updated state.

### Minimal client example

```python
import httpx

BASE = "http://localhost:8000"

# Start
init = httpx.post(f"{BASE}/conversation/init", json={
    "simulation_slug": "behavioral-interview-brenda",
    "session_id": "sess-123",  # backend-owned
}).json()
state = init["state"]

# Turn
turn = httpx.post(f"{BASE}/conversation/turn", json={
    "state": state,
    "user_message": "Hi Brenda, thanks for having me.",
}).json()
state = turn["state"]
print(turn["messages"][-1])
print(turn["goal_progress"])
```

## Gradio Dev Console (`--serve gradio`)

Browser UI at http://localhost:7860 with:

- Simulation picker and live chat
- Per-turn goal-progress dashboard
- Full state / trace / analysis inspectors
- Manual buttons for `inactivity` and `followup` proactive triggers

Intended for developers iterating on personas, prompts, and graph behaviour —
not as the backend's runtime target.

## Docker

The `Dockerfile` builds a self-contained image that runs the agent. By
default it starts the Gradio console on `7860`; override the command to run
the API server instead.

```bash
# Build
docker build -t careersim-agent ./agent

# Gradio dev console
docker run --rm -p 7860:7860 --env-file agent/.env careersim-agent

# FastAPI production server
docker run --rm -p 8000:8000 --env-file agent/.env careersim-agent \
  python -m careersim_agent.main --serve api --port 8000
```

> The top-level `docker-compose.local.yml` currently has the `agent` service
> commented out; run it standalone via `docker run` (above) until it's wired
> back into the compose stack.

## Configuration

Configuration is loaded from environment variables (or `.env`). See
`.env.example` for the authoritative list; the most important knobs are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | _(required)_ | Key for chat + embeddings + eval calls. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Swap for OpenRouter, etc. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Main conversation model. |
| `OPENAI_EVAL_MODEL` | _(falls back to main)_ | Cheaper model for sentiment / emotion / goal eval. |
| `RAG_ENABLED` | `true` | Toggle Chroma retrieval. |
| `RAG_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model. |
| `RAG_CHROMA_PERSIST_DIR` | `.chroma_db` | Persistent vector store path (relative to `agent/`). |
| `GRADIO_SERVER_PORT` | `7860` | Dev console port. |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR`. |

Simulations and personas are pure data — edit `data/simulations.json`,
`data/personas.json`, and the Markdown files under `data/documents/` to add or
tune scenarios. No code changes required.

## Project Structure

```
agent/
├── data/
│   ├── personas.json             # Persona definitions
│   ├── simulations.json          # Simulations + goals
│   └── documents/                # RAG corpus
│       ├── shared/               #   Cross-simulation knowledge
│       ├── personas/<slug>/      #   Per-persona background
│       └── simulations/<slug>/   #   Per-simulation context
├── src/careersim_agent/
│   ├── main.py                   # CLI entry (--serve gradio|api)
│   ├── config.py                 # pydantic-settings
│   ├── api/app.py                # FastAPI app factory
│   ├── graph/
│   │   ├── builder.py            # StateGraph wiring
│   │   ├── state.py              # ConversationState + goal progress
│   │   └── nodes/                # conversation, analysis, evaluation,
│   │                             # proactive, retrieval
│   ├── prompts/templates.py      # Prompt templates
│   ├── services/
│   │   ├── conversation_service.py  # Stateless orchestration layer
│   │   ├── data_loader.py           # Simulation + persona loader
│   │   ├── eval_service.py          # LLM-based evaluation
│   │   └── retrieval_service.py     # Chroma / RAG
│   └── ui/gradio_app.py          # Dev console
├── tests/
│   ├── test_api.py                   # FastAPI + statelessness contract
│   ├── test_conversation_service.py  # Service + serialisation + typing delay
│   ├── test_graph.py                 # Graph construction
│   └── test_data_consistency.py      # Persona/simulation data integrity
├── Dockerfile
├── pyproject.toml
└── .env.example
```

## Testing

```bash
uv run pytest                 # Full suite
uv run pytest tests/test_api.py -v
uv run pytest tests/test_api.py::TestStatelessness -v
```

The tests mock the LangGraph runnable where appropriate, so the suite runs
without an OpenAI API key.

## Development Notes

- Both run modes share the same `ConversationService`, which is the single
  source of truth for graph invocation, (de)serialisation, and typing-delay
  computation.
- The API is a pure function of its inputs — see `TestStatelessness` in
  `tests/test_api.py` for the contract. The backend owns all persistence.
- Graph-level nodes live in `src/careersim_agent/graph/nodes/` and are
  composed in `builder.py`; the flow is intentionally linear-with-branches so
  it's easy to trace in the dev console.
