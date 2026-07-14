"""Tests for the post-session debrief (eval_service.generate_debrief + API)."""

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# See test_analysis_node.py for why this import must come first.
import careersim_agent.services  # noqa: F401

from careersim_agent.api.app import create_api_app
from careersim_agent.services.eval_service import (
    DebriefGenerationError,
    EvalService,
    _bounded_transcript,
    _build_debrief_prompt,
    compute_goal_outcome,
    compute_transcript_stats,
)


# =============================================================================
# Deterministic helpers
# =============================================================================

class TestComputeGoalOutcome:
    def test_none_when_no_goals(self):
        assert compute_goal_outcome([]) is None

    def test_all_required_achieved_scores_100(self):
        progress = [
            {"goalNumber": 1, "status": "achieved", "isOptional": False},
            {"goalNumber": 2, "status": "achieved", "isOptional": False},
        ]
        outcome = compute_goal_outcome(progress)
        assert outcome["score"] == 100
        assert outcome["achieved_required"] == 2
        assert outcome["achieved_total"] == 2

    def test_unachieved_goals_use_confidence(self):
        progress = [
            {"goalNumber": 1, "status": "achieved", "isOptional": False},
            {"goalNumber": 2, "status": "in_progress", "confidence": 0.5, "isOptional": False},
        ]
        outcome = compute_goal_outcome(progress)
        assert outcome["score"] == 75

    def test_unachieved_confidence_never_counts_as_full(self):
        progress = [
            {"goalNumber": 1, "status": "in_progress", "confidence": 1.0, "isOptional": False},
        ]
        outcome = compute_goal_outcome(progress)
        assert outcome["score"] == 99

    def test_optional_goals_excluded_from_score_when_required_exist(self):
        progress = [
            {"goalNumber": 1, "status": "achieved", "isOptional": False},
            {"goalNumber": 2, "status": "not_started", "isOptional": True},
        ]
        outcome = compute_goal_outcome(progress)
        assert outcome["score"] == 100
        assert outcome["required"] == 1
        assert outcome["total"] == 2

    def test_falls_back_to_all_goals_when_none_required(self):
        progress = [
            {"goalNumber": 1, "status": "achieved", "isOptional": True},
            {"goalNumber": 2, "status": "not_started", "isOptional": True},
        ]
        outcome = compute_goal_outcome(progress)
        assert outcome["score"] == 50


class TestComputeTranscriptStats:
    def test_counts_messages_and_words_per_side(self):
        messages = [
            {"role": "ai", "content": "hello there candidate"},
            {"role": "human", "content": "hi nice to meet you"},
            {"role": "ai", "content": "tell me about yourself"},
        ]
        stats = compute_transcript_stats(messages)
        assert stats == {
            "message_count": 3,
            "user_message_count": 1,
            "ai_message_count": 2,
            "user_word_count": 5,
            "ai_word_count": 7,
        }


class TestBoundedTranscript:
    def test_short_transcript_untouched(self):
        lines = ["[0] USER: hi", "[1] BRENDA: hello"]
        assert _bounded_transcript(lines) == "\n".join(lines)

    def test_long_transcript_elides_middle(self):
        lines = [f"[{i}] USER: " + ("x" * 500) for i in range(200)]
        out = _bounded_transcript(lines)
        assert "omitted" in out
        # Opening and closing preserved.
        assert lines[0] in out
        assert lines[-1] in out
        assert len(out) < sum(len(l) for l in lines)


class TestBuildDebriefPrompt:
    def test_includes_rubric_goals_and_transcript(self):
        state = {
            "simulation": {
                "title": "The Behavioral Interview",
                "scenario": "You are interviewing...",
                "successCriteria": {
                    "communication": ["Clear responses"],
                    "problemSolving": ["STAR method"],
                    "emotional": ["Confidence building"],
                },
                "conversationGoals": [
                    {"goalNumber": 1, "title": "Opening", "isOptional": False},
                ],
            },
            "persona": {"name": "Brenda Vance", "role": "HR Manager"},
            "goal_progress": [{"goalNumber": 1, "status": "achieved"}],
            "messages": [
                {"role": "ai", "content": "Welcome."},
                {"role": "human", "content": "Thanks, Brenda!"},
            ],
        }
        prompt = _build_debrief_prompt(state)
        assert "Clear responses" in prompt
        assert "STAR method" in prompt
        assert "Confidence building" in prompt
        assert "Goal 1: Opening — status: achieved" in prompt
        assert "[1] USER: Thanks, Brenda!" in prompt
        assert "[0] BRENDA VANCE: Welcome." in prompt

    def test_includes_voice_signals_when_present(self):
        state = {
            "simulation": {},
            "persona": {"name": "P"},
            "messages": [{"role": "human", "content": "hi"}],
            "analysis": {"voice": {"user_avg_wpm": 132.5, "user_filler_count": 4}},
        }
        prompt = _build_debrief_prompt(state)
        assert "user_avg_wpm: 132.5" in prompt
        assert "user_filler_count: 4" in prompt


# =============================================================================
# generate_debrief (mocked LLM)
# =============================================================================

def _make_service(llm_payload=None, side_effect=None) -> EvalService:
    """Build an EvalService without touching ChatOpenAI construction."""
    svc = EvalService.__new__(EvalService)
    mock_llm = MagicMock()
    if side_effect is not None:
        mock_llm.invoke.side_effect = side_effect
    else:
        response = MagicMock()
        response.content = json.dumps(llm_payload)
        mock_llm.invoke.return_value = response
    svc._debrief_llm = mock_llm
    svc._llm = MagicMock()
    return svc


def _llm_payload(**overrides):
    payload = {
        "skills": {
            "clarity": {"score": 72, "rationale": "Structured answers."},
            "confidence": {"score": 65, "rationale": "Some hedging."},
            "problem_solving": {"score": 80, "rationale": "Good STAR usage."},
            "emotional_intelligence": {"score": 70, "rationale": "Read cues well."},
        },
        "emotional_tone": {
            "overall": "composed",
            "journey": [
                {"phase": "Opening", "tone": "nervous", "note": "Slow start."},
                {"phase": "Closing", "tone": "confident", "note": "Strong finish."},
            ],
        },
        "summary": "A solid session overall.",
        "strengths": ["Clear STAR structure"],
        "improvement_areas": ["Reduce hedging"],
        "advice": ["Practice concise openers"],
        "key_moments": [
            {"message_index": 1, "label": "Strong greeting", "note": "Warm opener."},
        ],
    }
    payload.update(overrides)
    return payload


def _state(**overrides):
    state = {
        "simulation": {
            "title": "Sim",
            "successCriteria": {},
            "conversationGoals": [
                {"goalNumber": 1, "title": "Opening", "isOptional": False},
            ],
        },
        "persona": {"name": "Brenda"},
        "goal_progress": [
            {"goalNumber": 1, "status": "achieved", "isOptional": False},
        ],
        "messages": [
            {"role": "ai", "content": "Welcome to the interview."},
            {"role": "human", "content": "Hi Brenda, thanks for having me."},
        ],
    }
    state.update(overrides)
    return state


class TestGenerateDebrief:
    def test_assembles_full_report(self):
        svc = _make_service(_llm_payload())
        report = svc.generate_debrief(_state())

        assert report["version"] == 1
        skill_keys = [s["key"] for s in report["skills"]]
        assert skill_keys == [
            "clarity",
            "confidence",
            "problem_solving",
            "emotional_intelligence",
            "goal_outcome",
        ]
        # goal_outcome: 1/1 required achieved => 100.
        assert report["skills"][-1]["score"] == 100
        assert report["goal_outcome"]["achieved_required"] == 1
        assert report["overall_score"] == round((72 + 65 + 80 + 70 + 100) / 5)
        assert report["emotional_tone"]["overall"] == "composed"
        assert len(report["emotional_tone"]["journey"]) == 2
        assert report["strengths"] == ["Clear STAR structure"]
        assert report["stats"]["user_message_count"] == 1
        assert report["voice"] is None

    def test_key_moments_resolve_role_and_drop_bad_indexes(self):
        payload = _llm_payload(
            key_moments=[
                {"message_index": 1, "label": "Greeting", "note": "n"},
                {"message_index": 99, "label": "Out of range", "note": "n"},
                {"message_index": -1, "label": "Negative", "note": "n"},
                "garbage",
            ],
        )
        svc = _make_service(payload)
        report = svc.generate_debrief(_state())
        assert len(report["key_moments"]) == 1
        assert report["key_moments"][0]["role"] == "human"

    def test_scores_clamped_to_0_100(self):
        payload = _llm_payload()
        payload["skills"]["clarity"]["score"] = 250
        payload["skills"]["confidence"]["score"] = -10
        svc = _make_service(payload)
        report = svc.generate_debrief(_state())
        by_key = {s["key"]: s["score"] for s in report["skills"]}
        assert by_key["clarity"] == 100
        assert by_key["confidence"] == 0

    def test_voice_passthrough(self):
        svc = _make_service(_llm_payload())
        state = _state(analysis={"voice": {"user_avg_wpm": 120.0}})
        report = svc.generate_debrief(state)
        assert report["voice"] == {"user_avg_wpm": 120.0}

    def test_no_goals_omits_goal_outcome_skill(self):
        svc = _make_service(_llm_payload())
        state = _state(goal_progress=[], simulation={"title": "Sim"})
        report = svc.generate_debrief(state)
        assert report["goal_outcome"] is None
        assert [s["key"] for s in report["skills"]] == [
            "clarity",
            "confidence",
            "problem_solving",
            "emotional_intelligence",
        ]

    def test_raises_without_human_messages(self):
        svc = _make_service(_llm_payload())
        state = _state(messages=[{"role": "ai", "content": "hello?"}])
        with pytest.raises(DebriefGenerationError):
            svc.generate_debrief(state)

    def test_raises_on_llm_failure(self):
        svc = _make_service(side_effect=RuntimeError("llm down"))
        with pytest.raises(DebriefGenerationError):
            svc.generate_debrief(_state())

    def test_raises_on_missing_skill_score(self):
        payload = _llm_payload()
        del payload["skills"]["confidence"]
        svc = _make_service(payload)
        with pytest.raises(DebriefGenerationError):
            svc.generate_debrief(_state())


# =============================================================================
# API endpoint
# =============================================================================

@pytest.fixture
def client():
    return TestClient(create_api_app())


class TestDebriefEndpoint:
    def test_route_exists(self, client):
        route_set = set()
        for route in client.app.routes:
            if hasattr(route, "methods") and hasattr(route, "path"):
                for method in route.methods:
                    route_set.add((method, route.path))
        assert ("POST", "/conversation/debrief") in route_set

    def test_missing_state_returns_422(self, client):
        resp = client.post("/conversation/debrief", json={})
        assert resp.status_code == 422

    def test_no_human_messages_returns_422(self, client):
        resp = client.post("/conversation/debrief", json={
            "state": {"messages": [{"role": "ai", "content": "hi"}]},
        })
        assert resp.status_code == 422
        assert "user has sent a message" in resp.json()["detail"]

    def test_returns_report_from_service(self, client):
        svc = _make_service(_llm_payload())
        with patch(
            "careersim_agent.services.eval_service.get_eval_service",
            return_value=svc,
        ):
            resp = client.post("/conversation/debrief", json={"state": _state()})
        assert resp.status_code == 200, resp.text
        report = resp.json()["report"]
        assert report["overall_score"] > 0
        assert len(report["skills"]) == 5

    def test_llm_failure_returns_502(self, client):
        svc = _make_service(side_effect=RuntimeError("llm down"))
        with patch(
            "careersim_agent.services.eval_service.get_eval_service",
            return_value=svc,
        ):
            resp = client.post("/conversation/debrief", json={"state": _state()})
        assert resp.status_code == 502
