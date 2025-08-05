#!/usr/bin/env python3
"""
Model Downloader Script for FastAPI Transformer Models Microservice
Pre-downloads all required models to cache them in Docker image
This dramatically improves startup times for subsequent container runs
"""

import os
import logging
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    AutoConfig,
    pipeline
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model configurations (same as main.py)
MODELS_CONFIG = {
    "sentiment": {
        "name": "cardiffnlp/twitter-roberta-base-sentiment-latest",
        "description": "Twitter RoBERTa sentiment analysis"
    },
    "toxicity": {
        "name": "martin-ha/toxic-comment-model", 
        "description": "Toxic comment classification"
    },
    "emotion": {
        "name": "j-hartmann/emotion-english-distilroberta-base",
        "description": "Emotion classification"
    },
    "sequence": {
        "name": "facebook/bart-large-mnli",
        "description": "Zero-shot sequence classification"
    }
}

def download_regular_models():
    """Download tokenizer, config, and model for regular classification models"""
    for model_key in ["sentiment", "toxicity", "emotion"]:
        config = MODELS_CONFIG[model_key]
        model_name = config["name"]
        
        logger.info(f"🔽 Downloading {model_key.capitalize()} model: {model_name}")
        
        try:
            # Download tokenizer
            logger.info(f"  📝 Downloading tokenizer...")
            tokenizer = AutoTokenizer.from_pretrained(model_name)
            
            # Download config
            logger.info(f"  ⚙️  Downloading config...")
            model_config = AutoConfig.from_pretrained(model_name)
            
            # Download model
            logger.info(f"  🧠 Downloading model weights...")
            model = AutoModelForSequenceClassification.from_pretrained(model_name)
            
            logger.info(f"  ✅ {model_key.capitalize()} model downloaded successfully")
            
            # Clear memory
            del tokenizer, model_config, model
            
        except Exception as e:
            logger.error(f"  ❌ Failed to download {model_key} model: {str(e)}")
            raise e

def download_pipeline_models():
    """Download pipeline-based models (sequence classification)"""
    model_key = "sequence"
    config = MODELS_CONFIG[model_key]
    model_name = config["name"]
    
    logger.info(f"🔽 Downloading {model_key.capitalize()} model: {model_name}")
    
    try:
        # Download pipeline model
        logger.info(f"  🔧 Downloading pipeline model...")
        classifier = pipeline(
            "zero-shot-classification",
            model=model_name
        )
        
        logger.info(f"  ✅ {model_key.capitalize()} model downloaded successfully")
        
        # Clear memory
        del classifier
        
    except Exception as e:
        logger.error(f"  ❌ Failed to download {model_key} model: {str(e)}")
        raise e

def verify_cache_directory():
    """Verify that the cache directory exists and is writable"""
    cache_dir = os.environ.get('TRANSFORMERS_CACHE', '/app/models_cache')
    
    logger.info(f"📁 Cache directory: {cache_dir}")
    
    if not os.path.exists(cache_dir):
        logger.info(f"  Creating cache directory...")
        os.makedirs(cache_dir, exist_ok=True)
    
    if not os.access(cache_dir, os.W_OK):
        logger.error(f"  ❌ Cache directory is not writable!")
        raise PermissionError(f"Cannot write to cache directory: {cache_dir}")
    
    logger.info(f"  ✅ Cache directory is ready")

def main():
    """Main download function"""
    logger.info("🚀 Starting model download process...")
    logger.info("=" * 60)
    
    # Verify cache directory
    verify_cache_directory()
    
    logger.info("\n📦 This will download the following models:")
    for model_key, config in MODELS_CONFIG.items():
        logger.info(f"  • {model_key.capitalize()}: {config['name']}")
    
    logger.info(f"\n💡 Total download size: ~4-6GB")
    logger.info("⏱️  This may take several minutes depending on your internet connection...\n")
    
    try:
        # Download regular models (sentiment, toxicity, emotion)
        download_regular_models()
        
        # Download pipeline models (sequence)
        download_pipeline_models()
        
        # Summary
        logger.info("\n" + "=" * 60)
        logger.info("🎉 All models downloaded successfully!")
        logger.info("📈 Container startup time will now be significantly faster!")
        
        # Show cache directory info
        cache_dir = os.environ.get('TRANSFORMERS_CACHE', '/app/models_cache')
        if os.path.exists(cache_dir):
            total_size = sum(
                os.path.getsize(os.path.join(dirpath, filename))
                for dirpath, dirnames, filenames in os.walk(cache_dir)
                for filename in filenames
            )
            size_mb = total_size / (1024 * 1024)
            logger.info(f"💾 Total cache size: {size_mb:.1f} MB")
            
            # Count files
            file_count = sum(
                len(filenames)
                for dirpath, dirnames, filenames in os.walk(cache_dir)
            )
            logger.info(f"📄 Total cached files: {file_count}")
        
    except Exception as e:
        logger.error(f"\n❌ Model download failed: {str(e)}")
        logger.error("🔧 This may be due to:")
        logger.error("   • Network connectivity issues")
        logger.error("   • Insufficient disk space") 
        logger.error("   • Hugging Face server issues")
        raise e

if __name__ == "__main__":
    main()