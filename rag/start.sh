#!/bin/bash

# ChromaDB RAG Microservice Startup Script

echo "🚀 Starting ChromaDB RAG Microservice..."

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

exec uvicorn main:app --host 0.0.0.0 --port ${API_PORT:-8002} --reload

