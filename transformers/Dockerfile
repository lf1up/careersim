# FastAPI Transformer Models Microservice Dockerfile
# Multi-stage build to pre-download models and improve startup times

# Stage 1: Model downloader
FROM python:3.11-slim as model-downloader

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

# Stage 2: Final runtime image
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

# Copy cached models from first stage
COPY --from=model-downloader /app/models_cache /app/models_cache

# Copy application code
COPY . .

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser
RUN chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8000

# Health check with longer start period for model loading
HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]