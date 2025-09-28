# FastAPI Transformer Models Microservice Dockerfile
# Multi-stage build to pre-download models and improve startup times

# Stage 1: Model downloader (CUDA-enabled base with PyTorch)
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables for model caching
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV TRANSFORMERS_CACHE=/app/models_cache
ENV HF_HOME=/app/models_cache

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Create models cache directory
RUN mkdir -p /app/models_cache

# Copy model downloader script
COPY download_models.py .

# Download all models during build time
RUN python download_models.py

# Stage 2: Final runtime image (TODO: change to CUDA-enabled base with PyTorch if needed)
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV TRANSFORMERS_CACHE=/app/models_cache
ENV HF_HOME=/app/models_cache

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Create models cache directory in the final stage
RUN mkdir -p /app/models_cache

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser

# Copy cached models from first stage with chown
COPY --from=model-downloader --chown=appuser:appuser /app/models_cache /app/models_cache

# Copy application code with chown
COPY --chown=appuser:appuser . .
USER appuser

# Expose port
EXPOSE 8001

# Health check with longer start period for model loading
HEALTHCHECK --interval=30s --timeout=10s --retries=5 CMD ["python", "-c", "import sys,httpx; r=httpx.get('http://localhost:8001/', timeout=5.0); sys.exit(0 if r.status_code == 200 else 1)"]

# Run the application
CMD ["sh", "-c", "uvicorn main:app --host ${API_HOST:-0.0.0.0} --port ${API_PORT:-8001} --log-level ${LOG_LEVEL:-info}"]