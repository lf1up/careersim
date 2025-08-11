#!/usr/bin/env python3
"""
FastAPI Microservice for Transformer Models
Serves four different Hugging Face transformer models for text classification:

1. Sentiment Analysis (cardiffnlp/twitter-roberta-base-sentiment-latest)
2. Toxicity Detection (martin-ha/toxic-comment-model)
3. Emotion Classification (j-hartmann/emotion-english-distilroberta-base)
4. Sequence Classification (facebook/bart-large-mnli)
"""

import os
import time
import logging
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager

import numpy as np
from scipy.special import softmax
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    AutoConfig,
    pipeline,
)

# Load environment variables
load_dotenv()

# Set cache directory for transformers (use environment variable or default)
os.environ.setdefault("TRANSFORMERS_CACHE", "/app/models_cache")
os.environ.setdefault("HF_HOME", "/app/models_cache")

# Authentication configuration
AUTH_TOKEN = os.getenv("AUTH_TOKEN")
if not AUTH_TOKEN:
    # Create default token if not provided
    AUTH_TOKEN = "default-dev-token-change-in-production-min-32-chars"
    logger = logging.getLogger(__name__)
    logger.warning("⚠️  No AUTH_TOKEN found in environment. Using default token!")
    logger.warning("🔒 Please set AUTH_TOKEN in .env file for production!")

if len(AUTH_TOKEN) < 32:
    raise ValueError("AUTH_TOKEN must be at least 32 characters long for security!")

# Configure logging
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level, logging.INFO))
logger = logging.getLogger(__name__)

# Model configurations
MODELS_CONFIG = {
    "sentiment": {
        "name": "cardiffnlp/twitter-roberta-base-sentiment-latest",
        "description": "Twitter RoBERTa sentiment analysis (Negative/Neutral/Positive)",
        "labels": {0: "Negative", 1: "Neutral", 2: "Positive"},
        "preprocess": True,
    },
    "toxicity": {
        "name": "martin-ha/toxic-comment-model",
        "description": "Toxic comment classification (Non-toxic/Toxic)",
        "labels": {0: "Non-toxic", 1: "Toxic"},
        "preprocess": False,
    },
    "emotion": {
        "name": "j-hartmann/emotion-english-distilroberta-base",
        "description": "Emotion classification (anger/disgust/fear/joy/neutral/sadness/surprise)",
        "labels": {
            0: "anger",
            1: "disgust",
            2: "fear",
            3: "joy",
            4: "neutral",
            5: "sadness",
            6: "surprise",
        },
        "preprocess": False,
    },
    "sequence": {
        "name": "facebook/bart-large-mnli",
        "description": "Zero-shot sequence classification",
        "labels": {},  # Dynamic based on candidate labels
        "preprocess": False,
    },
}

# Global variables to store loaded models
models = {}
tokenizers = {}
configs = {}
pipelines = {}

# Security
security = HTTPBearer()


def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    """Verify the authentication token"""
    if credentials.credentials != AUTH_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


def get_auth_dependency():
    """Get authentication dependency - can be disabled for development"""
    auth_required = os.getenv("AUTH_REQUIRED", "true").lower() == "true"
    if auth_required:
        return Depends(verify_token)
    else:
        return None


# Pydantic models for API
class TextInput(BaseModel):
    text: str = Field(..., description="Text to analyze", min_length=1, max_length=1024)


class SequenceInput(BaseModel):
    text: str = Field(..., description="Text to classify", min_length=1, max_length=1024)
    candidate_labels: List[str] = Field(
        ..., description="List of possible labels", min_items=1
    )


class ClassificationResult(BaseModel):
    label: str = Field(..., description="Predicted label")
    confidence: float = Field(..., description="Confidence score", ge=0.0, le=1.0)
    processing_time_ms: float = Field(
        ..., description="Processing time in milliseconds"
    )


class DetailedClassificationResult(BaseModel):
    predictions: List[Dict[str, Any]] = Field(
        ..., description="All predictions with scores"
    )
    top_prediction: ClassificationResult = Field(..., description="Top prediction")
    processing_time_ms: float = Field(
        ..., description="Processing time in milliseconds"
    )


class HealthCheck(BaseModel):
    status: str
    models_loaded: List[str]
    message: str
    cache_info: Dict[str, Any] = Field(default_factory=dict)


def preprocess_twitter_text(text: str) -> str:
    """
    Preprocess text for Twitter-based models
    (username and link placeholders)
    """
    new_text = []
    for t in text.split(" "):
        t = "@user" if t.startswith("@") and len(t) > 1 else t
        t = "http" if t.startswith("http") else t
        new_text.append(t)
    return " ".join(new_text)


def check_cache_status():
    """Check and log cache directory status"""
    cache_dir = os.environ.get("TRANSFORMERS_CACHE", "/app/models_cache")

    if os.path.exists(cache_dir):
        try:
            total_size = sum(
                os.path.getsize(os.path.join(dirpath, filename))
                for dirpath, dirnames, filenames in os.walk(cache_dir)
                for filename in filenames
            )
            size_mb = total_size / (1024 * 1024)
            file_count = sum(
                len(filenames) for dirpath, dirnames, filenames in os.walk(cache_dir)
            )

            logger.info(f"💾 Model cache: {cache_dir}")
            logger.info(f"📦 Cache size: {size_mb:.1f} MB ({file_count} files)")

            if size_mb > 100:  # If cache has substantial content
                logger.info("🚀 Using cached models - startup will be fast!")
            else:
                logger.info("⬇️  Models will be downloaded - first startup may be slow")

        except Exception as e:
            logger.warning(f"⚠️  Could not check cache status: {str(e)}")
    else:
        logger.info(f"📁 Creating cache directory: {cache_dir}")
        os.makedirs(cache_dir, exist_ok=True)


async def load_models():
    """Load all transformer models on startup"""
    logger.info("Loading transformer models...")

    # Check cache status before loading
    check_cache_status()

    for model_key, config in MODELS_CONFIG.items():
        if model_key == "sequence":
            # For sequence classification, we use pipeline approach
            try:
                logger.info(f"Loading {model_key.capitalize()} model: {config['name']}")
                pipelines[model_key] = pipeline(
                    "zero-shot-classification", model=config["name"]
                )
                logger.info(f"✅ {model_key.capitalize()} model loaded successfully")
            except Exception as e:
                logger.error(
                    f"❌ Failed to load {model_key.capitalize()} model: {str(e)}"
                )
                raise e
        else:
            # For other models, load tokenizer, config, and model
            try:
                logger.info(f"Loading {model_key.capitalize()} model: {config['name']}")
                tokenizers[model_key] = AutoTokenizer.from_pretrained(config["name"])
                configs[model_key] = AutoConfig.from_pretrained(config["name"])
                models[model_key] = AutoModelForSequenceClassification.from_pretrained(
                    config["name"]
                )
                logger.info(f"✅ {model_key.capitalize()} model loaded successfully")
            except Exception as e:
                logger.error(
                    f"❌ Failed to load {model_key.capitalize()} model: {str(e)}"
                )
                raise e

    logger.info("🎉 All models loaded successfully!")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await load_models()
    yield
    # Shutdown
    logger.info("Shutting down...")


# Create FastAPI app
auth_required = os.getenv("AUTH_REQUIRED", "true").lower() == "true"
auth_status = (
    "🔒 Authentication Required"
    if auth_required
    else "🔓 Authentication Disabled (Development)"
)

app = FastAPI(
    title="Transformer Models Microservice",
    description=f"""FastAPI service providing text classification using multiple Hugging Face transformer models.
    
{auth_status}

## Authentication
All endpoints require Bearer token authentication (except /docs and /openapi.json).
Include the token in the Authorization header: `Authorization: Bearer YOUR_TOKEN`

## Models Available
- **Sentiment Analysis**: Twitter RoBERTa sentiment analysis
- **Toxicity Detection**: Toxic comment classification  
- **Emotion Classification**: Emotion detection in text
- **Zero-shot Classification**: Custom label classification
""",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_model_components(model_key: str):
    """Dependency to get model components"""
    if model_key not in models:
        raise HTTPException(status_code=500, detail=f"Model {model_key} not loaded")
    return models[model_key], tokenizers[model_key], configs[model_key]


@app.get("/", response_model=Dict[str, Any])
async def root():
    """Root endpoint with service information"""
    return {
        "service": "Transformer Models Microservice",
        "version": "1.0.0",
        "models": {
            key: {
                "name": config["name"],
                "description": config["description"],
                "endpoint": f"/{key}",
            }
            for key, config in MODELS_CONFIG.items()
        },
        "endpoints": [
            "/sentiment - Twitter sentiment analysis",
            "/toxicity - Toxic comment detection",
            "/emotion - Emotion classification",
            "/sequence - Zero-shot sequence classification",
            "/health - Health check",
            "/docs - API documentation",
        ],
    }


@app.get("/health", response_model=HealthCheck)
async def health_check(token: str = get_auth_dependency()):
    """Health check endpoint with cache information"""
    loaded_models = []

    # Check regular models
    for model_key in ["sentiment", "toxicity", "emotion"]:
        if model_key in models and model_key in tokenizers and model_key in configs:
            loaded_models.append(model_key)

    # Check pipeline model
    if "sequence" in pipelines:
        loaded_models.append("sequence")

    all_loaded = len(loaded_models) == len(MODELS_CONFIG)

    # Get cache information
    cache_info = {}
    cache_dir = os.environ.get("TRANSFORMERS_CACHE", "/app/models_cache")

    if os.path.exists(cache_dir):
        try:
            total_size = sum(
                os.path.getsize(os.path.join(dirpath, filename))
                for dirpath, dirnames, filenames in os.walk(cache_dir)
                for filename in filenames
            )
            file_count = sum(
                len(filenames) for dirpath, dirnames, filenames in os.walk(cache_dir)
            )

            cache_info = {
                "cache_directory": cache_dir,
                "cache_size_mb": round(total_size / (1024 * 1024), 1),
                "cached_files": file_count,
                "cache_exists": True,
            }
        except Exception:
            cache_info = {
                "cache_directory": cache_dir,
                "cache_exists": True,
                "error": "Could not read cache information",
            }
    else:
        cache_info = {"cache_directory": cache_dir, "cache_exists": False}

    return HealthCheck(
        status="healthy" if all_loaded else "partial",
        models_loaded=loaded_models,
        message=f"Service is {'fully operational' if all_loaded else 'partially operational'}",
        cache_info=cache_info,
    )


@app.post("/sentiment", response_model=DetailedClassificationResult)
async def analyze_sentiment(input_data: TextInput, token: str = get_auth_dependency()):
    """
    Analyze sentiment of text using Twitter RoBERTa model
    Labels: Negative, Neutral, Positive
    """
    start_time = time.time()

    try:
        model, tokenizer, config = get_model_components("sentiment")

        # Preprocess text for Twitter model
        processed_text = preprocess_twitter_text(input_data.text)

        # Tokenize and predict
        encoded_input = tokenizer(
            processed_text, return_tensors="pt", truncation=True, max_length=1024
        )
        output = model(**encoded_input)
        scores = output[0][0].detach().numpy()
        scores = softmax(scores)

        # Prepare results
        predictions = []
        for i, score in enumerate(scores):
            label = MODELS_CONFIG["sentiment"]["labels"][i]
            predictions.append({"label": label, "confidence": float(score)})

        # Sort by confidence
        predictions.sort(key=lambda x: x["confidence"], reverse=True)

        processing_time = (time.time() - start_time) * 1000

        return DetailedClassificationResult(
            predictions=predictions,
            top_prediction=ClassificationResult(
                label=predictions[0]["label"],
                confidence=predictions[0]["confidence"],
                processing_time_ms=processing_time,
            ),
            processing_time_ms=processing_time,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Sentiment analysis failed: {str(e)}"
        )


@app.post("/toxicity", response_model=ClassificationResult)
async def detect_toxicity(input_data: TextInput, token: str = get_auth_dependency()):
    """
    Detect toxicity in text using DistilBERT model
    Labels: Non-toxic, Toxic
    """
    start_time = time.time()

    try:
        model, tokenizer, config = get_model_components("toxicity")

        # Tokenize and predict
        encoded_input = tokenizer(
            input_data.text, return_tensors="pt", truncation=True, max_length=1024
        )
        output = model(**encoded_input)
        scores = output[0][0].detach().numpy()
        scores = softmax(scores)

        # Get prediction
        predicted_id = np.argmax(scores)
        confidence = float(scores[predicted_id])
        label = MODELS_CONFIG["toxicity"]["labels"][predicted_id]

        processing_time = (time.time() - start_time) * 1000

        return ClassificationResult(
            label=label, confidence=confidence, processing_time_ms=processing_time
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Toxicity detection failed: {str(e)}"
        )


@app.post("/emotion", response_model=DetailedClassificationResult)
async def classify_emotion(input_data: TextInput, token: str = get_auth_dependency()):
    """
    Classify emotion in text using DistilRoBERTa model
    Labels: anger, disgust, fear, joy, neutral, sadness, surprise
    """
    start_time = time.time()

    try:
        model, tokenizer, config = get_model_components("emotion")

        # Tokenize and predict
        encoded_input = tokenizer(
            input_data.text, return_tensors="pt", truncation=True, max_length=1024
        )
        output = model(**encoded_input)
        scores = output[0][0].detach().numpy()
        scores = softmax(scores)

        # Prepare results
        predictions = []
        for i, score in enumerate(scores):
            label = MODELS_CONFIG["emotion"]["labels"][i]
            predictions.append({"label": label, "confidence": float(score)})

        # Sort by confidence
        predictions.sort(key=lambda x: x["confidence"], reverse=True)

        processing_time = (time.time() - start_time) * 1000

        return DetailedClassificationResult(
            predictions=predictions,
            top_prediction=ClassificationResult(
                label=predictions[0]["label"],
                confidence=predictions[0]["confidence"],
                processing_time_ms=processing_time,
            ),
            processing_time_ms=processing_time,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Emotion classification failed: {str(e)}"
        )


@app.post("/sequence", response_model=DetailedClassificationResult)
async def classify_sequence(
    input_data: SequenceInput, token: str = get_auth_dependency()
):
    """
    Zero-shot sequence classification using BART model
    Provide your own candidate labels
    """
    start_time = time.time()

    try:
        if "sequence" not in pipelines:
            raise HTTPException(
                status_code=500, detail="Sequence classification model not loaded"
            )

        classifier = pipelines["sequence"]

        # Perform zero-shot classification
        result = classifier(input_data.text, input_data.candidate_labels)

        # Prepare results
        predictions = []
        for label, score in zip(result["labels"], result["scores"]):
            predictions.append({"label": label, "confidence": float(score)})

        processing_time = (time.time() - start_time) * 1000

        return DetailedClassificationResult(
            predictions=predictions,
            top_prediction=ClassificationResult(
                label=predictions[0]["label"],
                confidence=predictions[0]["confidence"],
                processing_time_ms=processing_time,
            ),
            processing_time_ms=processing_time,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Sequence classification failed: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn

    # Get configuration from environment variables
    api_host = os.getenv("API_HOST", "0.0.0.0")
    api_port = int(os.getenv("API_PORT", "8001"))
    api_reload = os.getenv("API_RELOAD", "false").lower() == "true"

    uvicorn.run(app, host=api_host, port=api_port, reload=api_reload)
