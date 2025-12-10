#!/bin/bash

# FastAPI Transformer Models Microservice Startup Script

echo "🚀 Starting FastAPI Transformer Models Microservice..."

# Check for environment file
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Creating from example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "📝 Please edit .env file and set your AUTH_TOKEN before production use!"
    else
        echo "🔒 Using default authentication token (change in production!)"
    fi
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔄 Activating virtual environment..."
source venv/bin/activate

# Install/upgrade dependencies
echo "📥 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Set up model caching
export TRANSFORMERS_CACHE="$(pwd)/models_cache"
export HF_HOME="$(pwd)/models_cache"

# Check if models directory exists (for caching)
if [ ! -d "models_cache" ]; then
    echo "📁 Creating models cache directory..."
    mkdir -p models_cache
fi

# Check if models are already cached
if [ -d "models_cache" ] && [ "$(ls -A models_cache)" ]; then
    cache_size=$(du -sh models_cache | cut -f1)
    echo "💾 Found existing model cache: $cache_size"
    echo "🚀 Startup will be fast!"
else
    echo "⬇️  Models will be downloaded on first run..."
    echo "💡 This may take 3-5 minutes but subsequent runs will be fast!"
fi

echo "🌟 Starting the service..."
echo "📖 API Documentation will be available at: http://${API_HOST:-0.0.0.0}:${API_PORT:-8001}/docs"
echo "🏥 Health check available at: http://${API_HOST:-0.0.0.0}:${API_PORT:-8001}/health"
echo ""
echo "⚠️  First startup may take several minutes to download models!"
echo "💡 Use Ctrl+C to stop the service"
echo ""

# Start the FastAPI service
python main.py