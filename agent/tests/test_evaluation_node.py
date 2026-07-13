"""Tests for `careersim_agent.graph.nodes.evaluation`."""

from unittest.mock import MagicMock, patch

# See test_analysis_node.py for why this import must come first.
import careersim_agent.services  # noqa: F401

from careersim_agent.graph.nodes.evaluation import _get_current_goal, evaluate_goals
from careersim_agent.graph.state import create_initial_state

GOAL_1 = {
    "goalNumber": 1,
    "title": "Ask about the role",
    "isOptional": False,
    "successIndicators": ["asked a question"],
}
GOAL_2_OPTIONAL = {
    "goalNumber": 2,
    "title": "Bonus goal",
    "isOptional": True,
}


def _sim(goals):
    return {"conversationGoals": goals}


def _base_state(**overrides):
    state = create_initial_state(
        session_id="s-1",
        simulation=_sim([GOAL_1, GOAL_2_OPTIONAL]),
        persona={"conversationStyle": {}},
    )
    state.update(overrides)
    return state


def _eval_result(behavior_score=0.0, success_score=0.0, reasoning=""):
    return {
        "behavior_score": behavior_score,
        "behavior_label": "engaged",
        "success_score": success_score,
        "success_label": "clear ask",
        "reasoning": reasoning,
    }


class TestGetCurrentGoal:
    def test_returns_first_unachieved_required_goal(self):
        progress = [{"goalNumber": 1, "status": "not_started"}]
        goal = _get_current_goal([GOAL_1, GOAL_2_OPTIONAL], progress)
        assert goal["goalNumber"] == 1

    def test_falls_back_to_optional_goal_once_required_are_achieved(self):
        progress = [
            {"goalNumber": 1, "status": "achieved"},
            {"goalNumber": 2, "status": "not_started"},
        ]
        goal = _get_current_goal([GOAL_1, GOAL_2_OPTIONAL], progress)
        assert goal["goalNumber"] == 2

    def test_returns_none_when_everything_is_achieved(self):
        progress = [
            {"goalNumber": 1, "status": "achieved"},
            {"goalNumber": 2, "status": "achieved"},
        ]
        assert _get_current_goal([GOAL_1, GOAL_2_OPTIONAL], progress) is None


class TestEvaluateGoals:
    def test_skips_when_not_needs_evaluation(self):
        state = _base_state(needs_evaluation=False)
        result = evaluate_goals(state)
        assert result["evaluation_complete"] is True
        assert result["node_trace"][0]["output_summary"] == "Skipped"

    def test_skips_when_no_goals_defined(self):
        state = _base_state(needs_evaluation=True, simulation=_sim([]))
        result = evaluate_goals(state)
        assert result["evaluation_complete"] is True
        assert result["needs_evaluation"] is False

    def test_marks_complete_when_all_goals_already_achieved(self):
        state = _base_state(
            needs_evaluation=True,
            goal_progress=[
                {"goalNumber": 1, "status": "achieved"},
                {"goalNumber": 2, "status": "achieved"},
            ],
        )
        result = evaluate_goals(state)
        assert result["evaluation_complete"] is True
        assert result["needs_evaluation"] is False
        assert all(p["status"] == "achieved" for p in result["goal_progress"])

    def test_initializes_progress_from_goals_when_absent(self):
        state = _base_state(needs_evaluation=True, goal_progress=[])
        mock_service = MagicMock()
        mock_service.evaluate_goal_progress.return_value = _eval_result()
        with patch(
            "careersim_agent.graph.nodes.evaluation.get_eval_service",
            return_value=mock_service,
        ):
            result = evaluate_goals(state)

        assert len(result["goal_progress"]) == 2
        assert result["goal_progress"][0]["goalNumber"] == 1
        assert result["goal_progress"][0]["status"] == "in_progress"

    def test_records_evidence_and_marks_goal_achieved_when_thresholds_met(self):
        state = _base_state(
            needs_evaluation=True,
            last_user_message="I'd like to know more about day-to-day responsibilities.",
            last_ai_message="Sure, let me explain.",
            message_count=3,
        )
        mock_service = MagicMock()
        mock_service.evaluate_goal_progress.return_value = _eval_result(
            behavior_score=0.8, success_score=0.75,
        )
        with patch(
            "careersim_agent.graph.nodes.evaluation.get_eval_service",
            return_value=mock_service,
        ):
            result = evaluate_goals(state)

        goal_1_progress = next(p for p in result["goal_progress"] if p["goalNumber"] == 1)
        assert goal_1_progress["status"] == "achieved"
        assert goal_1_progress["confidence"] == 0.8
        assert len(goal_1_progress["evidence"]) == 2
        assert result["evaluation_complete"] is True
        assert result["needs_evaluation"] is False
        mock_service.evaluate_goal_progress.assert_called_once()

    def test_does_not_achieve_goal_when_evidence_is_insufficient(self):
        state = _base_state(needs_evaluation=True)
        mock_service = MagicMock()
        # High scores but no successIndicators-backed success + low evidence count
        mock_service.evaluate_goal_progress.return_value = _eval_result(
            behavior_score=0.05, success_score=0.05,
        )
        with patch(
            "careersim_agent.graph.nodes.evaluation.get_eval_service",
            return_value=mock_service,
        ):
            result = evaluate_goals(state)

        goal_1_progress = next(p for p in result["goal_progress"] if p["goalNumber"] == 1)
        assert goal_1_progress["status"] == "in_progress"

    def test_respects_custom_evaluation_config_thresholds(self):
        goal = dict(GOAL_1)
        goal["evaluationConfig"] = {
            "behaviorThreshold": 0.1,
            "successThreshold": 0.1,
            "minEvidenceCount": 1,
            "minStrongEvidenceCount": 1,
            "strongEvidenceScore": 0.1,
        }
        state = _base_state(needs_evaluation=True, simulation=_sim([goal]))
        mock_service = MagicMock()
        mock_service.evaluate_goal_progress.return_value = _eval_result(
            behavior_score=0.2, success_score=0.2,
        )
        with patch(
            "careersim_agent.graph.nodes.evaluation.get_eval_service",
            return_value=mock_service,
        ):
            result = evaluate_goals(state)

        goal_1_progress = next(p for p in result["goal_progress"] if p["goalNumber"] == 1)
        assert goal_1_progress["status"] == "achieved"

    def test_reevaluates_existing_in_progress_goal_without_resetting_started_at(self):
        state = _base_state(
            needs_evaluation=True,
            goal_progress=[
                {
                    "goalNumber": 1,
                    "isOptional": False,
                    "title": GOAL_1["title"],
                    "status": "in_progress",
                    "confidence": 0.3,
                    "evidence": [],
                    "startedAt": "2024-01-01T00:00:00",
                },
                {
                    "goalNumber": 2,
                    "isOptional": True,
                    "title": GOAL_2_OPTIONAL["title"],
                    "status": "not_started",
                    "confidence": 0.0,
                    "evidence": [],
                },
            ],
        )
        mock_service = MagicMock()
        mock_service.evaluate_goal_progress.return_value = _eval_result(
            behavior_score=0.4, success_score=0.0,
        )
        with patch(
            "careersim_agent.graph.nodes.evaluation.get_eval_service",
            return_value=mock_service,
        ):
            result = evaluate_goals(state)

        goal_1_progress = next(p for p in result["goal_progress"] if p["goalNumber"] == 1)
        assert goal_1_progress["startedAt"] == "2024-01-01T00:00:00"
        assert goal_1_progress["confidence"] == 0.4
