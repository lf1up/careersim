# CareerSim Agent

A standalone Python LangGraph agent with a Gradio developer UI for career simulation conversations.

## Features

- **LangGraph-based conversation flow** with persona-driven AI responses
- **Local HuggingFace transformers** for sentiment and emotion analysis
- **Goal evaluation** using zero-shot classification
- **Gradio developer console** with:
  - Real-time state inspection
  - Node execution tracing
  - Goal progress dashboard
  - Manual trigger buttons (inactivity, followup)

## Quick Start

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

> **Note**: First run will download HuggingFace models (~500MB). Set `SKIP_PRELOAD=1` to defer this.

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
│   ├── services/           # Data loader, transformers
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
- Local transformers instead of external service
