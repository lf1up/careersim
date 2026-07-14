"""LLM-based evaluation service using the configured EVAL_MODEL.

Replaces the local HuggingFace transformer models with API calls to
an OpenAI-compatible LLM for sentiment analysis, emotion detection,
and goal progress evaluation. Language-agnostic and GPU-free.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Iterable, Literal, Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
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


class DebriefGenerationError(RuntimeError):
    """Raised when the LLM debrief call fails or returns unusable output.

    Unlike per-turn sentiment (where a neutral fallback is harmless), a
    fabricated debrief with zeroed scores would actively mislead the user —
    so we surface the failure and let the API return an error the client
    can retry."""


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


# -----------------------------------------------------------------------------
# Session debrief (post-session report)
#
# One structured LLM call over the FULL transcript + the simulation's rubric,
# combined with deterministic stats computed from goal_progress and message
# counts. The wire shape is consumed by the API's `GET /sessions/:id/report`
# and cached there keyed by message count.
# -----------------------------------------------------------------------------

_DEBRIEF_SKILL_KEYS = (
    "clarity",
    "confidence",
    "problem_solving",
    "emotional_intelligence",
)

_DEBRIEF_SYSTEM = """You are an expert communication coach reviewing a completed career-simulation practice conversation between a USER (the trainee) and an AI PERSONA playing a professional role.

You will receive the scenario, its success criteria rubric, the conversation goals with their final statuses, and the full indexed transcript.

Evaluate ONLY the USER's performance. Be specific, fair, and constructive — cite what actually happened in the conversation. Scores are 0-100:
- 0-39: needs significant work; 40-59: developing; 60-79: solid; 80-100: strong.

Score these four skills:
1. "clarity" — how clear and structured the user's communication was (use the communication criteria).
2. "confidence" — how assured and composed the user came across (hedging, filler, decisiveness, owning their answers).
3. "problem_solving" — quality of reasoning, structure, and relevance of examples (use the problem-solving criteria).
4. "emotional_intelligence" — reading and responding to the persona's emotional cues (use the emotional criteria).

Also produce:
- "emotional_tone": the user's overall tone label (one or two words) plus a 2-4 phase journey across the conversation (each phase: a short name, a tone label, and one sentence of note).
- "summary": 2-3 sentences summarizing how the session went overall.
- "strengths": 2-4 concrete things the user did well.
- "improvement_areas": 2-4 concrete things to improve.
- "advice": 2-4 actionable next steps the user can practice.
- "key_moments": 2-4 pivotal transcript moments. Use the exact message index shown in [brackets], and only indexes of USER messages when highlighting user behaviour.

Respond ONLY with a JSON object, no markdown fences, no extra text:
{
  "skills": {
    "clarity": {"score": <int 0-100>, "rationale": "<1 sentence>"},
    "confidence": {"score": <int 0-100>, "rationale": "<1 sentence>"},
    "problem_solving": {"score": <int 0-100>, "rationale": "<1 sentence>"},
    "emotional_intelligence": {"score": <int 0-100>, "rationale": "<1 sentence>"}
  },
  "emotional_tone": {
    "overall": "<label>",
    "journey": [{"phase": "<short name>", "tone": "<label>", "note": "<1 sentence>"}]
  },
  "summary": "<2-3 sentences>",
  "strengths": ["<item>"],
  "improvement_areas": ["<item>"],
  "advice": ["<item>"],
  "key_moments": [{"message_index": <int>, "label": "<short title>", "note": "<1 sentence>"}]
}"""

# Keep the transcript prompt bounded so very long sessions don't blow the
# context window. We keep the opening (rapport) and the most recent tail
# (closing) and elide the middle with a marker.
_DEBRIEF_MAX_TRANSCRIPT_CHARS = 24_000
_DEBRIEF_MAX_MESSAGE_CHARS = 800


def _format_transcript_lines(
    messages: list[dict[str, Any]],
    persona_name: str,
) -> list[str]:
    lines: list[str] = []
    for idx, msg in enumerate(messages):
        role = msg.get("role", "unknown")
        speaker = "USER" if role == "human" else persona_name.upper()
        content = str(msg.get("content", ""))
        if len(content) > _DEBRIEF_MAX_MESSAGE_CHARS:
            content = content[:_DEBRIEF_MAX_MESSAGE_CHARS] + " […]"
        lines.append(f"[{idx}] {speaker}: {content}")
    return lines


def _bounded_transcript(lines: list[str]) -> str:
    """Join transcript lines, eliding the middle when over budget."""
    total = sum(len(l) + 1 for l in lines)
    if total <= _DEBRIEF_MAX_TRANSCRIPT_CHARS:
        return "\n".join(lines)

    head: list[str] = []
    tail: list[str] = []
    budget = _DEBRIEF_MAX_TRANSCRIPT_CHARS
    # Reserve roughly a third for the opening, the rest for the tail.
    head_budget = budget // 3
    used = 0
    for line in lines:
        if used + len(line) + 1 > head_budget:
            break
        head.append(line)
        used += len(line) + 1
    tail_budget = budget - used
    tail_used = 0
    for line in reversed(lines[len(head):]):
        if tail_used + len(line) + 1 > tail_budget:
            break
        tail.append(line)
        tail_used += len(line) + 1
    tail.reverse()
    omitted = len(lines) - len(head) - len(tail)
    marker = f"[… {omitted} message(s) omitted …]"
    return "\n".join([*head, marker, *tail])


def _build_debrief_prompt(state: dict[str, Any]) -> str:
    simulation = state.get("simulation") or {}
    persona = state.get("persona") or {}
    persona_name = str(persona.get("name") or "Persona")

    criteria = simulation.get("successCriteria") or {}

    def _criteria_block(title: str, items: Any) -> str:
        entries = list(items or [])
        body = "\n".join(f"- {c}" for c in entries) if entries else "(none)"
        return f"### {title}\n{body}"

    goal_lines: list[str] = []
    progress_by_number = {
        p.get("goalNumber"): p for p in (state.get("goal_progress") or [])
    }
    for goal in simulation.get("conversationGoals") or []:
        number = goal.get("goalNumber")
        progress = progress_by_number.get(number) or {}
        status = progress.get("status", "not_started")
        optional = " (optional)" if goal.get("isOptional") else ""
        goal_lines.append(
            f"- Goal {number}{optional}: {goal.get('title', '')} — status: {status}"
        )
    if not goal_lines:
        for number, progress in sorted(
            (k, v) for k, v in progress_by_number.items() if k is not None
        ):
            goal_lines.append(
                f"- Goal {number}: {progress.get('title', '')} — "
                f"status: {progress.get('status', 'not_started')}"
            )

    transcript = _bounded_transcript(
        _format_transcript_lines(list(state.get("messages") or []), persona_name)
    )

    voice_block = ""
    analysis = state.get("analysis") or {}
    voice = analysis.get("voice") if isinstance(analysis, dict) else None
    if isinstance(voice, dict) and voice:
        interesting = {
            k: voice.get(k)
            for k in (
                "user_avg_wpm",
                "user_filler_count",
                "user_filler_density_per_100w",
                "user_avg_response_latency_sec",
                "longest_silence_sec",
                "user_interrupt_count",
            )
            if voice.get(k) is not None
        }
        if interesting:
            voice_block = "\n## Voice signals (from a voice call in this session)\n" + "\n".join(
                f"- {k}: {v}" for k, v in interesting.items()
            )

    return f"""## Scenario
Title: {simulation.get('title', '')}
Persona: {persona_name} ({persona.get('role', '')})
Scenario: {simulation.get('scenario', '')}

## Success criteria rubric
{_criteria_block('Communication', criteria.get('communication'))}
{_criteria_block('Problem solving', criteria.get('problemSolving'))}
{_criteria_block('Emotional', criteria.get('emotional'))}

## Conversation goals (final status)
{chr(10).join(goal_lines) if goal_lines else '(none)'}
{voice_block}

## Transcript (message index in brackets)
{transcript}"""


def compute_goal_outcome(goal_progress: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Deterministic goal-outcome block derived from goal_progress.

    Score = mean over required goals of (1.0 if achieved else progress
    confidence clamped to [0, 0.99]) × 100. Falls back to all goals when
    the simulation declares no required ones; returns None when there are
    no tracked goals at all.
    """
    goals = [g for g in goal_progress if isinstance(g, dict)]
    if not goals:
        return None
    required = [g for g in goals if not g.get("isOptional")]
    scored = required if required else goals

    per_goal: list[float] = []
    for g in scored:
        if g.get("status") == "achieved":
            per_goal.append(1.0)
        else:
            confidence = g.get("confidence")
            value = float(confidence) if isinstance(confidence, (int, float)) else 0.0
            per_goal.append(max(0.0, min(0.99, value)))

    achieved_required = sum(1 for g in scored if g.get("status") == "achieved")
    achieved_total = sum(1 for g in goals if g.get("status") == "achieved")
    return {
        "score": round(100 * sum(per_goal) / len(per_goal)),
        "total": len(goals),
        "required": len(scored) if required else len(goals),
        "achieved_required": achieved_required,
        "achieved_total": achieved_total,
    }


def compute_transcript_stats(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Message/word counts per side. Duration is added API-side (the agent
    wire state carries no timestamps)."""
    user_messages = [m for m in messages if m.get("role") == "human"]
    ai_messages = [m for m in messages if m.get("role") == "ai"]

    def words(items: list[dict[str, Any]]) -> int:
        return sum(len(str(m.get("content", "")).split()) for m in items)

    return {
        "message_count": len(messages),
        "user_message_count": len(user_messages),
        "ai_message_count": len(ai_messages),
        "user_word_count": words(user_messages),
        "ai_word_count": words(ai_messages),
    }


def _clamp_score(value: Any) -> Optional[int]:
    try:
        return max(0, min(100, round(float(value))))
    except (TypeError, ValueError):
        return None


def _string_list(value: Any, limit: int = 6) -> list[str]:
    if not isinstance(value, list):
        return []
    out = [str(v).strip() for v in value if isinstance(v, str) and str(v).strip()]
    return out[:limit]


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
            **({"default_headers": eval_cfg["default_headers"]} if eval_cfg.get("default_headers") else {}),
        )
        # Separate instance for debriefs: the report JSON is much larger
        # than a per-turn sentiment/goal payload, so make sure the output
        # budget can't truncate it mid-object.
        self._debrief_llm = ChatOpenAI(
            model=eval_cfg["model"],
            api_key=eval_cfg["api_key"],
            temperature=eval_cfg["temperature"],
            max_tokens=max(int(eval_cfg["max_tokens"] or 0), 2000),
            top_p=eval_cfg["top_p"],
            frequency_penalty=eval_cfg["frequency_penalty"],
            presence_penalty=eval_cfg["presence_penalty"],
            **({"base_url": eval_cfg["base_url"]} if eval_cfg.get("base_url") else {}),
            **({"default_headers": eval_cfg["default_headers"]} if eval_cfg.get("default_headers") else {}),
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

    def generate_debrief(self, state: dict[str, Any]) -> dict[str, Any]:
        """Generate a full post-session debrief report from a wire-format state.

        Combines one structured LLM call (skills, tone journey, advice, key
        moments) with deterministic stats (goal outcome, message/word counts,
        voice-signal passthrough). Raises :class:`DebriefGenerationError` on
        LLM failure — callers must not cache a fabricated report.
        """
        from datetime import datetime, timezone

        messages = [m for m in (state.get("messages") or []) if isinstance(m, dict)]
        if not any(m.get("role") == "human" for m in messages):
            raise DebriefGenerationError(
                "Cannot generate a debrief before the user has sent a message"
            )

        prompt = _build_debrief_prompt(state)
        try:
            resp = self._debrief_llm.invoke([
                SystemMessage(content=_DEBRIEF_SYSTEM),
                HumanMessage(content=prompt),
            ])
            data = _parse_json_response(str(resp.content))
        except Exception as e:
            logger.error(f"Debrief generation failed: {e}", exc_info=True)
            raise DebriefGenerationError(f"Debrief LLM call failed: {e}") from e

        skills_raw = data.get("skills") if isinstance(data.get("skills"), dict) else {}
        skills: list[dict[str, Any]] = []
        for key in _DEBRIEF_SKILL_KEYS:
            entry = skills_raw.get(key) if isinstance(skills_raw.get(key), dict) else {}
            score = _clamp_score(entry.get("score"))
            if score is None:
                raise DebriefGenerationError(
                    f"Debrief LLM output missing a usable score for '{key}'"
                )
            skills.append({
                "key": key,
                "score": score,
                "rationale": str(entry.get("rationale", "")).strip(),
            })

        goal_outcome = compute_goal_outcome(list(state.get("goal_progress") or []))
        if goal_outcome is not None:
            achieved = goal_outcome["achieved_required"]
            required = goal_outcome["required"]
            skills.append({
                "key": "goal_outcome",
                "score": goal_outcome["score"],
                "rationale": (
                    f"{achieved} of {required} required goal"
                    f"{'' if required == 1 else 's'} achieved."
                ),
            })

        overall = round(sum(s["score"] for s in skills) / len(skills))

        tone_raw = (
            data.get("emotional_tone")
            if isinstance(data.get("emotional_tone"), dict)
            else {}
        )
        journey: list[dict[str, str]] = []
        for phase in tone_raw.get("journey") or []:
            if not isinstance(phase, dict):
                continue
            journey.append({
                "phase": str(phase.get("phase", "")).strip(),
                "tone": str(phase.get("tone", "")).strip(),
                "note": str(phase.get("note", "")).strip(),
            })

        max_index = len(messages) - 1
        key_moments: list[dict[str, Any]] = []
        for moment in data.get("key_moments") or []:
            if not isinstance(moment, dict):
                continue
            idx = moment.get("message_index")
            if not isinstance(idx, int) or idx < 0 or idx > max_index:
                continue
            key_moments.append({
                "message_index": idx,
                "role": messages[idx].get("role", "unknown"),
                "label": str(moment.get("label", "")).strip(),
                "note": str(moment.get("note", "")).strip(),
            })

        analysis = state.get("analysis") or {}
        voice = analysis.get("voice") if isinstance(analysis, dict) else None

        return {
            "version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "overall_score": overall,
            "skills": skills,
            "goal_outcome": goal_outcome,
            "stats": compute_transcript_stats(messages),
            "emotional_tone": {
                "overall": str(tone_raw.get("overall", "")).strip(),
                "journey": journey,
            },
            "summary": str(data.get("summary", "")).strip(),
            "strengths": _string_list(data.get("strengths")),
            "improvement_areas": _string_list(data.get("improvement_areas")),
            "advice": _string_list(data.get("advice")),
            "key_moments": key_moments,
            "voice": voice if isinstance(voice, dict) and voice else None,
        }


_service_instance: Optional[EvalService] = None


@lru_cache(maxsize=1)
def get_eval_service() -> EvalService:
    """Get the singleton EvalService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = EvalService()
    return _service_instance


# -----------------------------------------------------------------------------
# Voice-aware evaluation
#
# Pure analytics over per-turn voice metadata captured by the agent-voice
# worker. No LLM — the LangGraph nodes already evaluate the *content* of each
# utterance via the goal-eval path; this layer adds spoken-only signals
# (pacing, fillers, latency, silence handling, barge-ins) that the existing
# text path can't see. Results land on `state.analysis.voice` and surface in
# the post-session feedback view.
# -----------------------------------------------------------------------------

# Conservative single-token filler set. Multi-word fillers ("you know",
# "I mean", "like") are detected via the `_FILLER_PHRASE_PATTERNS` below
# so we don't over-count "like" as a verb ("I like that") or "well" as
# an adverb ("did well"). Tuned against PERSONAS.md sample dialogue.
_FILLER_TOKENS: frozenset[str] = frozenset(
    {
        "um",
        "uh",
        "uhh",
        "umm",
        "er",
        "erm",
        "hm",
        "hmm",
        "huh",
        "ah",
        "ahh",
        "eh",
    }
)

_FILLER_PHRASE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\byou know\b", re.IGNORECASE),
    re.compile(r"\bi mean\b", re.IGNORECASE),
    re.compile(r"\bsort of\b", re.IGNORECASE),
    re.compile(r"\bkind of\b", re.IGNORECASE),
    # `like` as a hedge: we only count it when at least one comma is
    # adjacent (e.g. "It was, like, tough" or "and like, yeah"). That
    # keeps "I like the way" from triggering. Doesn't catch every
    # spoken hedge, but the alternative (any standalone `like`) was
    # noisy enough that the persona's filler density looked off.
    re.compile(r",\s*like\b", re.IGNORECASE),
    re.compile(r"\blike\s*,", re.IGNORECASE),
)

_WORD_PATTERN = re.compile(r"[A-Za-z']+")


@dataclass
class VoiceTurnMetadata:
    """Per-turn audio metadata recorded by the agent-voice worker.

    Captured at LiveKit-pipeline time and persisted alongside each
    turn in `state.analysis.voice.turns`. Keep field names snake_case
    so JSON serialisation matches the rest of the wire format.
    """
    role: Literal["human", "ai"]
    transcript: str
    # Wall-clock seconds (room-relative) when the turn's audio first
    # crossed the VAD threshold and when it ended.
    audio_start_sec: float
    audio_end_sec: float
    # Wall-clock seconds when the *previous* turn ended (the user
    # equivalent of "the AI just stopped speaking"). Used to compute
    # time-to-respond. None on the first turn of the call.
    prior_turn_ended_sec: Optional[float] = None
    # True when this turn was cut short because the other party
    # started speaking before it finished.
    was_interrupted: bool = False
    # Only meaningful for AI turns: the count of user-initiated
    # barge-ins observed during this reply.
    barge_in_count: int = 0


@dataclass
class VoiceSignals:
    """Aggregate voice signals computed for a whole session.

    Designed to be JSON-friendly via `dataclasses.asdict` — every
    field is a plain Python primitive or list of primitives.
    """
    # User pacing: words per minute the user spoke, averaged across
    # their turns (weighted by turn duration so a long monologue
    # outweighs a single "yes").
    user_avg_wpm: float = 0.0
    # Persona pacing: same metric for the AI side. Lets a
    # post-session view sanity-check that the persona's voice
    # block (`speakingRateWpm`) holds up in practice.
    ai_avg_wpm: float = 0.0
    # Filler-word count + density on the user side. Density is
    # "fillers per 100 words" so longer conversations don't
    # mechanically inflate the count.
    user_filler_count: int = 0
    user_filler_density_per_100w: float = 0.0
    # Time-to-respond (seconds) from when the persona stopped
    # speaking to when the user started — averaged across user
    # turns where the prior turn was the AI. Long values suggest
    # the user was unsure or thinking.
    user_avg_response_latency_sec: float = 0.0
    user_max_response_latency_sec: float = 0.0
    # Longest single block of silence (no audio from either side)
    # in seconds. Captures "the user froze" moments.
    longest_silence_sec: float = 0.0
    # Number of times the user cut the persona off mid-sentence,
    # and the inverse (AI talking over the user).
    user_interrupt_count: int = 0
    ai_interrupt_count: int = 0
    # Total user / persona speaking time in seconds.
    user_speaking_time_sec: float = 0.0
    ai_speaking_time_sec: float = 0.0
    # Provenance: list of warnings produced during analysis. Empty
    # when everything looked clean. Surfaced verbatim in the
    # feedback panel so QA can debug suspicious metrics without
    # opening a debugger.
    warnings: list[str] = field(default_factory=list)


def _count_fillers(transcript: str) -> int:
    """Count filler words / phrases in `transcript`.

    Uses a fixed token set (`_FILLER_TOKENS`) for single-token
    fillers and a small regex set for multi-word hedges. Case
    insensitive. Punctuation is ignored — the tokenizer keeps only
    `[A-Za-z']+`.
    """
    if not transcript:
        return 0
    tokens = [w.lower() for w in _WORD_PATTERN.findall(transcript)]
    single = sum(1 for w in tokens if w in _FILLER_TOKENS)
    multi = sum(len(p.findall(transcript)) for p in _FILLER_PHRASE_PATTERNS)
    return single + multi


def _word_count(transcript: str) -> int:
    if not transcript:
        return 0
    return len(_WORD_PATTERN.findall(transcript))


def compute_voice_signals(
    turns: Iterable[VoiceTurnMetadata | dict[str, Any]],
) -> VoiceSignals:
    """Compute aggregate voice signals from per-turn audio metadata.

    Pure function — no LLM call, no I/O. Accepts either dataclass
    instances or plain dicts (post-JSON round-trip) so callers can
    feed it whatever shape they have on hand. Unknown / missing
    fields fall back to safe defaults; the returned ``warnings``
    list flags any abnormal inputs.
    """
    normalised: list[VoiceTurnMetadata] = []
    warnings: list[str] = []

    for raw in turns:
        if isinstance(raw, VoiceTurnMetadata):
            normalised.append(raw)
            continue
        if not isinstance(raw, dict):
            warnings.append(f"non-dict turn skipped: {type(raw).__name__}")
            continue
        try:
            normalised.append(
                VoiceTurnMetadata(
                    role=raw["role"],  # type: ignore[arg-type]
                    transcript=str(raw.get("transcript", "")),
                    audio_start_sec=float(raw.get("audio_start_sec", 0.0)),
                    audio_end_sec=float(raw.get("audio_end_sec", 0.0)),
                    prior_turn_ended_sec=(
                        float(raw["prior_turn_ended_sec"])
                        if raw.get("prior_turn_ended_sec") is not None
                        else None
                    ),
                    was_interrupted=bool(raw.get("was_interrupted", False)),
                    barge_in_count=int(raw.get("barge_in_count", 0)),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            warnings.append(f"malformed turn skipped: {exc}")

    signals = VoiceSignals(warnings=warnings)
    if not normalised:
        return signals

    # Sort defensively — we want strictly chronological order for the
    # silence-gap analysis below. The worker should already feed us
    # turns in order, but a re-ordered list shouldn't blow the math.
    normalised.sort(key=lambda t: t.audio_start_sec)

    user_words = 0
    user_seconds = 0.0
    ai_words = 0
    ai_seconds = 0.0
    user_filler = 0
    user_response_latencies: list[float] = []
    longest_silence = 0.0
    last_audio_end: Optional[float] = None

    for turn in normalised:
        duration = max(0.0, turn.audio_end_sec - turn.audio_start_sec)
        words = _word_count(turn.transcript)

        if turn.role == "human":
            user_words += words
            user_seconds += duration
            user_filler += _count_fillers(turn.transcript)
            if turn.prior_turn_ended_sec is not None:
                latency = max(0.0, turn.audio_start_sec - turn.prior_turn_ended_sec)
                user_response_latencies.append(latency)
            if turn.was_interrupted:
                signals.ai_interrupt_count += 1  # AI cut off the user
        elif turn.role == "ai":
            ai_words += words
            ai_seconds += duration
            signals.user_interrupt_count += turn.barge_in_count

        if last_audio_end is not None:
            gap = max(0.0, turn.audio_start_sec - last_audio_end)
            longest_silence = max(longest_silence, gap)
        last_audio_end = max(last_audio_end or 0.0, turn.audio_end_sec)

    if user_seconds > 0:
        signals.user_avg_wpm = round(user_words / (user_seconds / 60.0), 1)
    if ai_seconds > 0:
        signals.ai_avg_wpm = round(ai_words / (ai_seconds / 60.0), 1)
    signals.user_filler_count = user_filler
    if user_words > 0:
        signals.user_filler_density_per_100w = round(
            user_filler / (user_words / 100.0), 2
        )
    if user_response_latencies:
        signals.user_avg_response_latency_sec = round(
            sum(user_response_latencies) / len(user_response_latencies), 2
        )
        signals.user_max_response_latency_sec = round(
            max(user_response_latencies), 2
        )
    signals.longest_silence_sec = round(longest_silence, 2)
    signals.user_speaking_time_sec = round(user_seconds, 2)
    signals.ai_speaking_time_sec = round(ai_seconds, 2)

    return signals


def voice_signals_to_dict(signals: VoiceSignals) -> dict[str, Any]:
    """Convert :class:`VoiceSignals` to a wire-friendly dict.

    Wraps :func:`dataclasses.asdict` with rounding so the dict that
    lands in `state.analysis.voice` matches what you'd see from the
    UI. Kept separate so callers can hold onto the dataclass
    instance for in-process analysis without paying the dict
    conversion cost twice.
    """
    from dataclasses import asdict

    return asdict(signals)
