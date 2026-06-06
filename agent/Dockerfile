# =============================================================================
# CareerSIM Agent - Core Microservice
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
# `ffmpeg` + `libsndfile` are needed by faster-whisper (audio I/O) and
# Piper at install time on slim images; they're tiny so we bake them
# in unconditionally rather than gating on a build arg. The voice
# extras themselves are only installed in the dedicated voice stage
# below; the regular runtime stage gets the chat-only deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    libsndfile1 \
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


# -----------------------------------------------------------------------------
# Stage 3: Voice runtime - same as runtime, plus the `voice` extras
# -----------------------------------------------------------------------------
# A separate stage so the chat-only `agent` container stays slim. The
# `voice` extra pulls in livekit-agents, faster-whisper, piper-tts,
# and websockets — all of which ride sizeable C-extension wheels
# (CTranslate2, onnxruntime, piper-phonemize). We also prefetch the
# default Piper voice + Whisper model so first-run `docker compose up`
# doesn't stall on a network download.
FROM runtime AS voice-runtime

USER root

# Switch back to the venv path so `uv` lives where the chat stage put it.
ENV PATH="/app/.venv/bin:$PATH"

# Install uv into this stage too (needed for the voice extras install).
RUN pip install --no-cache-dir uv

# Re-add the build deps we stripped in the slim runtime stage so
# transitively-built voice wheels (e.g. piper-phonemize) link cleanly.
# `ffmpeg` + `libsndfile1` are also needed at runtime by faster-whisper
# (audio I/O) and Piper — the slim runtime stage doesn't carry them, so
# re-install here to match the builder's audio libs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install the voice extras on top of the editable chat install.
RUN uv pip install --no-cache -e ".[voice]"

# Pin the HuggingFace cache to a fixed, appuser-owned path. faster-whisper
# resolves its model cache from HF_HOME; without this it falls back to the
# *running user's* ~/.cache/huggingface. The bug that motivated this: the
# prefetch used to run as root (-> /root/.cache/huggingface) while the
# runtime runs as `appuser` (-> /home/appuser/.cache/huggingface), so the
# baked-in model was invisible at runtime and got re-downloaded on the first
# call. That download blocks long enough that LiveKit kills the job as
# "unresponsive" (no audio, no transcript). Setting HF_HOME, prefetching as
# appuser, and mounting the compose `voice_whisper_cache` volume here keeps
# build-time, runtime, and the persistent volume all pointing at one cache.
ENV HF_HOME=/app/.hf_cache

# Copy the prefetch script and warm both Piper + Whisper caches into
# the image. Failures are logged but non-fatal — the runtime falls
# back to on-demand downloads when the cache is cold.
COPY --chown=appuser:appuser scripts/ ./scripts/
RUN mkdir -p /app/.piper_models /app/.hf_cache \
    && chown -R appuser:appuser /app/.piper_models /app/.hf_cache /app/scripts

# Prefetch as the SAME user that runs the worker so cache ownership +
# location match at runtime.
USER appuser
RUN python /app/scripts/prefetch_voice_models.py || true

# Voice worker entry point — joins LiveKit rooms minted by the API.
CMD ["python", "-m", "careersim_agent.main", "--serve", "voice"]
