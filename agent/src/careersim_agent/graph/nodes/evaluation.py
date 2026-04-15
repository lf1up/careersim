"""Goal evaluation node using the EVAL_MODEL LLM."""

import logging
from datetime import datetime
from typing import Any, Optional

from ..state import ConversationState, NodeTraceEntry, GoalProgressItem, EvidenceItem
from ...services import get_eval_service

logger = logging.getLogger(__name__)


DEFAULT_BEHAVIOR_THRESHOLD = 0.6
DEFAULT_SUCCESS_THRESHOLD = 0.6
DEFAULT_STRONG_EVIDENCE_SCORE = 0.55
DEFAULT_MIN_EVIDENCE_COUNT = 1
DEFAULT_MIN_STRONG_EVIDENCE_COUNT = 1


def _add_trace(
    state: ConversationState,
    node: str,
    start_time: datetime,
    input_summary: str,
    output_summary: str,
) -> list[NodeTraceEntry]:
    """Add a trace entry for node execution."""
    duration_ms = (datetime.now() - start_time).total_seconds() * 1000

    trace = state.get("node_trace", []).copy()
    trace.append(NodeTraceEntry(
        node=node,
        timestamp=start_time.isoformat(),
        duration_ms=round(duration_ms, 2),
        input_summary=input_summary,
        output_summary=output_summary,
    ))
    return trace


def _get_current_goal(
    goals: list[dict],
    progress: list[GoalProgressItem],
) -> Optional[dict]:
    """Get the current goal to evaluate (first unachieved in order)."""
    progress_map = {p["goalNumber"]: p for p in progress}
    sorted_goals = sorted(goals, key=lambda g: g.get("goalNumber", 0))

    for goal in sorted_goals:
        if goal.get("isOptional"):
            continue
        p = progress_map.get(goal.get("goalNumber", 0), {})
        if p.get("status") != "achieved":
            return goal

    for goal in sorted_goals:
        if not goal.get("isOptional"):
            continue
        p = progress_map.get(goal.get("goalNumber", 0), {})
        if p.get("status") != "achieved":
            return goal

    return None


def evaluate_goals(state: ConversationState) -> dict[str, Any]:
    """Evaluate conversation goals using the EVAL_MODEL LLM.

    Sends the current goal definition, the latest user/AI exchange, and
    existing evidence to the eval LLM. The LLM returns behaviour and
    success scores which are mapped back into GoalProgressItem / EvidenceItem.
    """
    start_time = datetime.now()
    session_id = state.get("session_id", "unknown")

    if not state.get("needs_evaluation"):
        logger.debug(f"[{session_id}] Evaluation not needed, skipping")
        trace = _add_trace(
            state, "evaluate_goals", start_time,
            "needs_evaluation=False", "Skipped",
        )
        return {"evaluation_complete": True, "node_trace": trace}

    logger.info(f"[{session_id}] Evaluating goals")

    simulation = state.get("simulation", {})
    goals = simulation.get("conversationGoals", [])

    if not goals:
        logger.debug(f"[{session_id}] No goals defined, skipping")
        trace = _add_trace(
            state, "evaluate_goals", start_time,
            "No goals", "Skipped",
        )
        return {
            "evaluation_complete": True,
            "needs_evaluation": False,
            "node_trace": trace,
        }

    progress = list(state.get("goal_progress", []))

    if not progress:
        progress = [
            GoalProgressItem(
                goalNumber=g.get("goalNumber", 0),
                isOptional=g.get("isOptional", False),
                title=g.get("title", ""),
                status="not_started",
                confidence=0.0,
                evidence=[],
            )
            for g in goals
        ]

    current_goal = _get_current_goal(goals, progress)

    if not current_goal:
        logger.info(f"[{session_id}] All goals achieved!")
        trace = _add_trace(
            state, "evaluate_goals", start_time,
            "All goals achieved", "Complete",
        )
        return {
            "goal_progress": progress,
            "evaluation_complete": True,
            "needs_evaluation": False,
            "node_trace": trace,
        }

    goal_num = current_goal.get("goalNumber", 0)
    logger.info(f"[{session_id}] Evaluating goal #{goal_num}: {current_goal.get('title', '')}")

    progress_idx = next(
        (i for i, p in enumerate(progress) if p["goalNumber"] == goal_num),
        None,
    )

    if progress_idx is None:
        progress.append(GoalProgressItem(
            goalNumber=goal_num,
            isOptional=current_goal.get("isOptional", False),
            title=current_goal.get("title", ""),
            status="not_started",
            confidence=0.0,
            evidence=[],
        ))
        progress_idx = len(progress) - 1

    target_progress = progress[progress_idx]

    if target_progress.get("status") == "not_started":
        target_progress["status"] = "in_progress"
        target_progress["startedAt"] = datetime.now().isoformat()

    eval_config = current_goal.get("evaluationConfig", {})
    behavior_threshold = eval_config.get("behaviorThreshold", DEFAULT_BEHAVIOR_THRESHOLD)
    success_threshold = eval_config.get("successThreshold", DEFAULT_SUCCESS_THRESHOLD)
    strong_evidence_score = eval_config.get("strongEvidenceScore", DEFAULT_STRONG_EVIDENCE_SCORE)
    min_evidence_count = eval_config.get("minEvidenceCount", DEFAULT_MIN_EVIDENCE_COUNT)
    min_strong_evidence_count = eval_config.get("minStrongEvidenceCount", DEFAULT_MIN_STRONG_EVIDENCE_COUNT)

    last_user_message = state.get("last_user_message", "")
    last_ai_message = state.get("last_ai_message", "")

    # --- LLM evaluation --------------------------------------------------
    service = get_eval_service()
    eval_result = service.evaluate_goal_progress(
        user_msg=last_user_message,
        ai_msg=last_ai_message,
        goal=current_goal,
        evidence_so_far=list(target_progress.get("evidence", [])),
    )

    behavior_score = eval_result["behavior_score"]
    success_score = eval_result["success_score"]
    message_count = state.get("message_count", 0)

    if behavior_score > 0:
        target_progress["confidence"] = max(
            target_progress.get("confidence", 0.0),
            behavior_score,
        )
        evidence = list(target_progress.get("evidence", []))
        evidence.append(EvidenceItem(
            messageIndex=message_count,
            role="user",
            label=eval_result["behavior_label"][:50] or "behavior",
            score=behavior_score,
        ))
        target_progress["evidence"] = evidence

    if success_score > 0:
        evidence = list(target_progress.get("evidence", []))
        evidence.append(EvidenceItem(
            messageIndex=message_count,
            role="ai",
            label=eval_result["success_label"][:50] or "success",
            score=success_score,
        ))
        target_progress["evidence"] = evidence

    # --- Achievement check ------------------------------------------------
    evidence = target_progress.get("evidence", [])
    evidence_count = len(evidence)
    strong_evidence_count = len([e for e in evidence if e.get("score", 0) >= strong_evidence_score])

    behavior_met = (
        behavior_score >= behavior_threshold
        and target_progress.get("confidence", 0) >= behavior_threshold
    )

    success_met = (
        success_score >= success_threshold
        if current_goal.get("successIndicators")
        else behavior_score >= behavior_threshold + 0.1
    )

    has_enough_evidence = (
        evidence_count >= min_evidence_count
        and strong_evidence_count >= min_strong_evidence_count
    )

    logger.info(
        f"[{session_id}] Goal #{goal_num} evaluation: "
        f"behavior={behavior_score:.2f}, success={success_score:.2f}, "
        f"behavior_met={behavior_met}, success_met={success_met}, "
        f"evidence={evidence_count}/{min_evidence_count}, "
        f"strong={strong_evidence_count}/{min_strong_evidence_count}"
    )
    if eval_result.get("reasoning"):
        logger.debug(f"[{session_id}] Eval reasoning: {eval_result['reasoning']}")

    if behavior_met and success_met and has_enough_evidence:
        if target_progress.get("status") != "achieved":
            target_progress["status"] = "achieved"
            target_progress["achievedAt"] = datetime.now().isoformat()
            logger.info(f"[{session_id}] Goal #{goal_num} ACHIEVED!")

    progress[progress_idx] = target_progress

    achieved_count = len([p for p in progress if p.get("status") == "achieved"])
    total_count = len(goals)

    trace = _add_trace(
        state, "evaluate_goals", start_time,
        f"goal #{goal_num}, behavior={behavior_score:.2f}, success={success_score:.2f}",
        f"status={target_progress.get('status')}, {achieved_count}/{total_count} achieved",
    )

    return {
        "goal_progress": progress,
        "evaluation_complete": True,
        "needs_evaluation": False,
        "node_trace": trace,
    }
