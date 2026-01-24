"""Local HuggingFace transformers for NLP analysis."""

import logging
from functools import lru_cache
from typing import TypedDict, Literal, Optional

logger = logging.getLogger(__name__)


class SentimentResult(TypedDict):
    """Sentiment analysis result."""
    sentiment: Literal["positive", "neutral", "negative"]
    confidence: float
    source: str


class EmotionResult(TypedDict):
    """Emotion analysis result."""
    emotion: str
    confidence: float
    source: str


class ClassificationResult(TypedDict):
    """Zero-shot classification result."""
    label: str
    confidence: float
    all_scores: dict[str, float]


class TransformersService:
    """Service for local HuggingFace transformer models.
    
    Models are loaded lazily on first use and cached.
    """
    
    # Model identifiers
    SENTIMENT_MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest"
    EMOTION_MODEL = "j-hartmann/emotion-english-distilroberta-base"
    CLASSIFICATION_MODEL = "facebook/bart-large-mnli"
    
    def __init__(self):
        self._sentiment_pipeline = None
        self._emotion_pipeline = None
        self._classification_pipeline = None
        self._models_loaded = False
    
    def _load_sentiment_model(self):
        """Lazy load sentiment analysis model."""
        if self._sentiment_pipeline is None:
            logger.info(f"Loading sentiment model: {self.SENTIMENT_MODEL}")
            from transformers import pipeline
            self._sentiment_pipeline = pipeline(
                "sentiment-analysis",
                model=self.SENTIMENT_MODEL,
                top_k=None,  # Return all labels with scores
            )
            logger.info("Sentiment model loaded")
        return self._sentiment_pipeline
    
    def _load_emotion_model(self):
        """Lazy load emotion analysis model."""
        if self._emotion_pipeline is None:
            logger.info(f"Loading emotion model: {self.EMOTION_MODEL}")
            from transformers import pipeline
            self._emotion_pipeline = pipeline(
                "text-classification",
                model=self.EMOTION_MODEL,
                top_k=None,
            )
            logger.info("Emotion model loaded")
        return self._emotion_pipeline
    
    def _load_classification_model(self):
        """Lazy load zero-shot classification model."""
        if self._classification_pipeline is None:
            logger.info(f"Loading classification model: {self.CLASSIFICATION_MODEL}")
            from transformers import pipeline
            self._classification_pipeline = pipeline(
                "zero-shot-classification",
                model=self.CLASSIFICATION_MODEL,
            )
            logger.info("Classification model loaded")
        return self._classification_pipeline
    
    def preload_models(self) -> None:
        """Preload all models (useful at startup)."""
        if not self._models_loaded:
            logger.info("Preloading all transformer models...")
            self._load_sentiment_model()
            self._load_emotion_model()
            self._load_classification_model()
            self._models_loaded = True
            logger.info("All models preloaded")
    
    def analyze_sentiment(self, text: str) -> SentimentResult:
        """Analyze sentiment of text.
        
        Args:
            text: Input text to analyze
            
        Returns:
            Sentiment result with label and confidence
        """
        try:
            pipeline = self._load_sentiment_model()
            results = pipeline(text[:512])  # Truncate for model limit
            
            # Map model labels to our standard labels
            label_map = {
                "positive": "positive",
                "negative": "negative", 
                "neutral": "neutral",
            }
            
            # Find best result
            if isinstance(results, list) and len(results) > 0:
                if isinstance(results[0], list):
                    results = results[0]
                
                best = max(results, key=lambda x: x["score"])
                label = best["label"].lower()
                
                return {
                    "sentiment": label_map.get(label, "neutral"),
                    "confidence": best["score"],
                    "source": "local",
                }
            
            return self._fallback_sentiment()
            
        except Exception as e:
            logger.warning(f"Sentiment analysis failed: {e}")
            return self._fallback_sentiment()
    
    def analyze_emotion(self, text: str) -> EmotionResult:
        """Analyze emotion of text.
        
        Args:
            text: Input text to analyze
            
        Returns:
            Emotion result with label and confidence
        """
        try:
            pipeline = self._load_emotion_model()
            results = pipeline(text[:512])
            
            if isinstance(results, list) and len(results) > 0:
                if isinstance(results[0], list):
                    results = results[0]
                
                best = max(results, key=lambda x: x["score"])
                
                return {
                    "emotion": best["label"].lower(),
                    "confidence": best["score"],
                    "source": "local",
                }
            
            return self._fallback_emotion()
            
        except Exception as e:
            logger.warning(f"Emotion analysis failed: {e}")
            return self._fallback_emotion()
    
    def classify_sequence(
        self, 
        text: str, 
        labels: list[str],
        multi_label: bool = False,
    ) -> ClassificationResult:
        """Zero-shot classification of text against candidate labels.
        
        Args:
            text: Input text to classify
            labels: List of candidate labels
            multi_label: Whether multiple labels can apply
            
        Returns:
            Classification result with best label and all scores
        """
        try:
            pipeline = self._load_classification_model()
            result = pipeline(
                text[:512],
                candidate_labels=labels,
                multi_label=multi_label,
            )
            
            # Build scores dict
            all_scores = dict(zip(result["labels"], result["scores"]))
            
            return {
                "label": result["labels"][0],
                "confidence": result["scores"][0],
                "all_scores": all_scores,
            }
            
        except Exception as e:
            logger.warning(f"Classification failed: {e}")
            return {
                "label": labels[0] if labels else "unknown",
                "confidence": 0.0,
                "all_scores": {label: 0.0 for label in labels},
            }
    
    def _fallback_sentiment(self) -> SentimentResult:
        """Fallback sentiment when analysis fails."""
        return {
            "sentiment": "neutral",
            "confidence": 0.5,
            "source": "fallback",
        }
    
    def _fallback_emotion(self) -> EmotionResult:
        """Fallback emotion when analysis fails."""
        return {
            "emotion": "neutral",
            "confidence": 0.5,
            "source": "fallback",
        }


# Singleton instance
_service_instance: Optional[TransformersService] = None


@lru_cache(maxsize=1)
def get_transformers_service() -> TransformersService:
    """Get the singleton transformers service instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = TransformersService()
    return _service_instance
