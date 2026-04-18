# =============================================================================
# CareerSim Agent - Core Microservice
# =============================================================================
# Multi-stage Dockerfile for the LangGraph conversation agent with Gradio API
# Connect from backend using gradio_client
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder - Install dependencies
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install uv for faster dependency installation
RUN pip install --no-cache-dir uv

# Copy files required to build the project wheel (pyproject declares
# `readme = "README.md"` and the wheel target is `src/careersim_agent`).
COPY pyproject.toml README.md ./
COPY src/ ./src/

# Create virtual environment and install the package in EDITABLE mode.
# Hatchling (PEP 660) writes a finder that records the absolute path of the
# source tree (`/app/src`), so at runtime `import careersim_agent` resolves
# to `/app/src/careersim_agent/…`. The compose file bind-mounts
# `./agent/src:/app/src`, which means host edits become live without a rebuild.
# NB: `uv venv` does NOT install pip into the venv — always drive installs
# through `uv pip` (never bare `pip install`), otherwise the command silently
# falls back to the system interpreter and the venv is never updated.
RUN uv venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN uv pip install --no-cache -e .

# -----------------------------------------------------------------------------
# Stage 2: Runtime - Final image
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

WORKDIR /app

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Gradio configuration for API access
ENV GRADIO_SERVER_NAME=0.0.0.0
ENV GRADIO_SERVER_PORT=7860

# Copy application code. The venv copied from the builder contains a PEP 660
# editable install whose finder references `/app/src/careersim_agent`, so the
# directory layout below must match what the builder saw. In dev the compose
# file overlays `/app/src` with a bind mount for live reload; in prod this
# baked-in copy is what gets served.
COPY --chown=appuser:appuser src/ ./src/
COPY --chown=appuser:appuser data/ ./data/
COPY --chown=appuser:appuser pyproject.toml README.md ./

RUN mkdir -p /app/logs /app/.chroma_db && chown -R appuser:appuser /app/logs /app/.chroma_db

# Switch to non-root user
USER appuser

# Expose Gradio port
EXPOSE 7860

# Health check - Gradio provides a /info endpoint
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
    CMD python -c "import httpx; r = httpx.get('http://localhost:7860/', timeout=5.0); exit(0 if r.status_code == 200 else 1)"

# Default command - run the agent
CMD ["python", "-m", "careersim_agent.main"]
