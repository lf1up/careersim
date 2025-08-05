#!/bin/bash

# Manual Model Caching Script for Local Development
# Pre-downloads all models to speed up subsequent API startups

echo "🚀 Pre-downloading Transformer Models for Caching..."
echo "=" * 60

# Set up environment
export TRANSFORMERS_CACHE="$(pwd)/models_cache"
export HF_HOME="$(pwd)/models_cache"

# Create cache directory
mkdir -p models_cache

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔄 Activating virtual environment..."
source venv/bin/activate

# Install dependencies if needed
echo "📥 Installing dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "⬇️  Starting model download process..."
echo "💡 This will download ~4-6GB of models"
echo "⏱️  Expected time: 3-5 minutes (depending on internet speed)"
echo ""

# Run the model downloader
python download_models.py

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 Model caching completed successfully!"
    
    # Show cache info
    if [ -d "models_cache" ]; then
        cache_size=$(du -sh models_cache | cut -f1)
        file_count=$(find models_cache -type f | wc -l)
        echo "💾 Cache size: $cache_size ($file_count files)"
    fi
    
    echo ""
    echo "🚀 Next API startup will be significantly faster!"
    echo "💡 Run './start.sh' to start the service"
else
    echo ""
    echo "❌ Model caching failed!"
    echo "🔧 Check your internet connection and try again"
    exit 1
fi