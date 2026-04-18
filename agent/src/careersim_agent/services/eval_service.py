"""LLM-based evaluation service using the configured EVAL_MODEL.

Replaces the local HuggingFace transformer models with API calls to
an OpenAI-compatible LLM for sentiment analysis, emotion detection,
and goal progress evaluation. Language-agnostic and GPU-free.
"""

import json
import logging
from functools import lru_cache
from typing import Any, Optional, TypedDict, Literal

from langchain_core.messages import SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI

from ..config import get_settings

logger = logging.getLogger(__name__)


class TextAnalysisResult(TypedDict):
    sentiment: Literal["positive", "neutral", "negative"]
    sentiment_confidence: float
    emotion: str
    emotion_confidence: float
    source: str


class GoalEvalResult(TypedDict):
    behavior_score: float
    behavior_label: str
    success_score: float
    success_label: str
    reasoning: str


_TEXT_ANALYSIS_SYSTEM = """You are a precise text-analysis assistant.
Analyze the user message and provide BOTH sentiment and emotion in a single response.

Sentiment: exactly one of positive, neutral, negative.
Emotion: exactly one of joy, sadness, anger, fear, surprise, disgust, neutral.
Confidence: a float between 0.0 and 1.0 for each.

Respond ONLY with a JSON object, no markdown fences, no extra text:
{"sentiment": "<positive|neutral|negative>", "sentiment_confidence": <float>, "emotion": "<label>", "emotion_confidence": <float>}"""

_GOAL_EVAL_SYSTEM = """You are an objective evaluator for a career-simulation training platform.

You will receive:
- The current conversation goal with its key behaviors and success indicators
- The latest user message and AI response
- Existing evidence collected so far

Your job is to evaluate BOTH dimensions independently:

1. **Behavior score** (0.0-1.0): How well does the USER message demonstrate any of the listed key behaviors? Score 0 if the user message is empty or irrelevant.
2. **Success score** (0.0-1.0): How well does the AI RESPONSE reflect any of the listed success indicators? Score 0 if the AI response is empty or irrelevant.

Be strict but fair. A score of 0.6+ means clear evidence. A score of 0.8+ means strong, explicit evidence.
If the message is tangential or only loosely related, score below 0.5.

Respond ONLY with a JSON object, no markdown fences, no extra text:
{
  "behavior_score": <float>,
  "behavior_label": "<which key behavior was best matched, or empty string>",
  "success_score": <float>,
  "success_label": "<which success indicator was best matched, or empty string>",
  "reasoning": "<1-2 sentence explanation>"
}"""


def _build_goal_eval_prompt(
    user_msg: str,
    ai_msg: str,
    goal: dict[str, Any],
    evidence_so_far: list[dict],
) -> str:
    """Build the user-turn prompt for goal evaluation."""
    behaviors = goal.get("keyBehaviors", [])
    indicators = goal.get("successIndicators", [])

    evidence_summary = "None yet."
    if evidence_so_far:
        items = []
        for e in evidence_so_far[-5:]:
            items.append(f"  - [{e.get('role','?')}] {e.get('label','')} (score={e.get('score',0):.2f})")
        evidence_summary = "\n".join(items)

    return f"""## Current Goal
Title: {goal.get('title', '')}
Description: {goal.get('description', '')}

## Key Behaviors (user should demonstrate)
{chr(10).join(f'- {b}' for b in behaviors) if behaviors else '(none)'}

## Success Indicators (AI response should reflect)
{chr(10).join(f'- {i}' for i in indicators) if indicators else '(none)'}

## Latest Exchange
**User message**: {user_msg or '(empty)'}
**AI response**: {ai_msg or '(empty)'}

## Evidence collected so far
{evidence_summary}"""


def _parse_json_response(text: str) -> dict:
    """Extract and parse a JSON object from LLM output, tolerating markdown fences."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    return json.loads(text)


class EvalService:
    """LLM-backed evaluation service using the configured EVAL_MODEL.

    Provides sentiment analysis, emotion detection, and goal-progress
    evaluation through structured LLM calls.
    """

    def __init__(self):
        settings = get_settings()
        eval_cfg = settings.openai_eval_config
        self._llm = ChatOpenAI(
            model=eval_cfg["model"],
            api_key=eval_cfg["api_key"],
            temperature=eval_cfg["temperature"],
            max_tokens=eval_cfg["max_tokens"],
            top_p=eval_cfg["top_p"],
            frequency_penalty=eval_cfg["frequency_penalty"],
            presence_penalty=eval_cfg["presence_penalty"],
            **({"base_url": eval_cfg["base_url"]} if eval_cfg.get("base_url") else {}),
        )
        logger.info(f"EvalService initialised with model={eval_cfg['model']}")

    def analyze_text(self, text: str) -> TextAnalysisResult:
        """Analyze sentiment and emotion of text in a single LLM call."""
        try:
            resp = self._llm.invoke([
                SystemMessage(content=_TEXT_ANALYSIS_SYSTEM),
                HumanMessage(content=text[:2000]),
            ])
            data = _parse_json_response(str(resp.content))

            sentiment = data.get("sentiment", "neutral").lower()
            if sentiment not in ("positive", "neutral", "negative"):
                sentiment = "neutral"

            return {
                "sentiment": sentiment,
                "sentiment_confidence": float(data.get("sentiment_confidence", 0.7)),
                "emotion": data.get("emotion", "neutral").lower(),
                "emotion_confidence": float(data.get("emotion_confidence", 0.7)),
                "source": "eval",
            }
        except Exception as e:
            logger.warning(f"Text analysis failed: {e}")
            return {
                "sentiment": "neutral",
                "sentiment_confidence": 0.5,
                "emotion": "neutral",
                "emotion_confidence": 0.5,
                "source": "fallback",
            }

    def evaluate_goal_progress(
        self,
        user_msg: str,
        ai_msg: str,
        goal: dict[str, Any],
        evidence_so_far: Optional[list[dict]] = None,
    ) -> GoalEvalResult:
        try:
            prompt = _build_goal_eval_prompt(
                user_msg, ai_msg, goal, evidence_so_far or [],
            )
            resp = self._llm.invoke([
                SystemMessage(content=_GOAL_EVAL_SYSTEM),
                HumanMessage(content=prompt),
            ])
            data = _parse_json_response(str(resp.content))
            return {
                "behavior_score": max(0.0, min(1.0, float(data.get("behavior_score", 0.0)))),
                "behavior_label": str(data.get("behavior_label", "")),
                "success_score": max(0.0, min(1.0, float(data.get("success_score", 0.0)))),
                "success_label": str(data.get("success_label", "")),
                "reasoning": str(data.get("reasoning", "")),
            }
        except Exception as e:
            logger.warning(f"Goal evaluation failed: {e}")
            return {
                "behavior_score": 0.0,
                "behavior_label": "",
                "success_score": 0.0,
                "success_label": "",
                "reasoning": f"evaluation error: {e}",
            }


_service_instance: Optional[EvalService] = None


@lru_cache(maxsize=1)
def get_eval_service() -> EvalService:
    """Get the singleton EvalService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = EvalService()
    return _service_instance
