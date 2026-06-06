"""Latency baseline for the voice pipeline.

Runs N synthetic round-trips through the *adapter* layer (no
LiveKit room, no audio I/O) and prints p50 / p95 / max for each
stage so we have a number to regress against.

This is intentionally NOT a benchmark of the real STT/TTS providers
— that depends on the model weights and is exercised by
``voice_smoke.py``. Here we use stubbed providers and measure:

* ``adapter.user_turn`` — the LangGraph round-trip per user turn
* ``stream_chunks`` — sentence-chunking pure-Python work
* ``adapter.finalize_voice_analysis`` — aggregate computation

Usage::

    cd agent && uv run python scripts/voice_perf.py --runs 50

Output is human-readable (whitespace-aligned table) plus one
machine-readable JSON line at the end so this can be wired into
a CI step and diffed across commits.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage

from careersim_agent.services.eval_service import VoiceTurnMetadata
from careersim_agent.voice.pipeline import LangGraphAdapter, stream_chunks


class _StubService:
    """In-memory stand-in for ConversationService.

    Mirrors the shape of the real LangGraph turn so we measure the
    overhead of state serialization + adapter glue rather than
    actual model latency (which would dwarf everything else and
    swamp the real baseline).
    """

    def invoke_turn(self, state: dict[str, Any], user_message: str) -> dict[str, Any]:
        out = dict(state)
        out["messages"] = list(state.get("messages") or []) + [
            HumanMessage(content=user_message),
            AIMessage(content="That's a good point. Tell me more about that."),
        ]
        return out

    def invoke_proactive(self, state: dict[str, Any], trigger: str) -> dict[str, Any]:
        out = dict(state)
        out["messages"] = list(state.get("messages") or []) + [
            AIMessage(content="Hello! Thanks for taking my call."),
        ]
        return out


def _percentile(samples: list[float], pct: float) -> float:
    if not samples:
        return 0.0
    samples = sorted(samples)
    k = max(0, min(len(samples) - 1, int(round((pct / 100.0) * (len(samples) - 1)))))
    return samples[k]


def _summary_ms(samples: list[float]) -> dict[str, float]:
    if not samples:
        return {"p50_ms": 0.0, "p95_ms": 0.0, "max_ms": 0.0, "mean_ms": 0.0, "n": 0}
    return {
        "p50_ms": round(_percentile(samples, 50) * 1000, 2),
        "p95_ms": round(_percentile(samples, 95) * 1000, 2),
        "max_ms": round(max(samples) * 1000, 2),
        "mean_ms": round(statistics.fmean(samples) * 1000, 2),
        "n": len(samples),
    }


async def _run_one_call(adapter: LangGraphAdapter) -> dict[str, list[float]]:
    """Drive one fake call and return per-stage timing samples."""
    user_turn_samples: list[float] = []
    chunker_samples: list[float] = []

    transcripts = [
        "Hi there, I have about ten years of backend experience.",
        "Mostly Python and Go on AWS — distributed systems work.",
        "Yeah, I'd be open to talking but I want to know the level first.",
        "What about comp band — what's the range you're working with?",
        "Got it. And the team — who would I be reporting to?",
    ]

    for transcript in transcripts:
        # Stage 1: full user_turn round-trip.
        t0 = time.perf_counter()
        result = await adapter.user_turn(transcript)
        user_turn_samples.append(time.perf_counter() - t0)

        # Stage 2: stream_chunks over the AI reply.
        t0 = time.perf_counter()
        chunks = [c async for c in stream_chunks(result.text)]
        chunker_samples.append(time.perf_counter() - t0)
        assert chunks, "stream_chunks emitted nothing"

        adapter.record_voice_turn(
            VoiceTurnMetadata(
                role="human", transcript=transcript,
                audio_start_sec=0.0, audio_end_sec=1.5,
            )
        )
        adapter.record_voice_turn(
            VoiceTurnMetadata(
                role="ai", transcript=result.text,
                audio_start_sec=1.8, audio_end_sec=3.5,
            )
        )

    return {"user_turn": user_turn_samples, "chunker": chunker_samples}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=20, help="Number of full calls.")
    args = parser.parse_args()

    initial_state = {
        "session_id": "perf-stub",
        "messages": [],
        "persona": {
            "slug": "vikram-shah-pipeline-recruiter",
            "name": "Vikram",
            "voice": {
                "speakingRateWpm": 135,
                "fillerWordFrequency": "medium",
                "providers": {"piper_local": {"voiceModel": "en_US-ryan-high"}},
            },
        },
        "proactive_trigger": None,
        "proactive_count": 0,
    }

    user_turn_all: list[float] = []
    chunker_all: list[float] = []
    finalize_all: list[float] = []

    for i in range(args.runs):
        adapter = LangGraphAdapter(initial_state, service=_StubService())
        timings = await _run_one_call(adapter)
        user_turn_all.extend(timings["user_turn"])
        chunker_all.extend(timings["chunker"])

        t0 = time.perf_counter()
        adapter.finalize_voice_analysis()
        finalize_all.append(time.perf_counter() - t0)

    summary = {
        "user_turn": _summary_ms(user_turn_all),
        "stream_chunks": _summary_ms(chunker_all),
        "finalize_voice_analysis": _summary_ms(finalize_all),
        "config": {"runs": args.runs, "turns_per_run": 5},
    }

    width = 28
    print(f"\n{'Stage':<{width}}  {'p50':>9}  {'p95':>9}  {'max':>9}  {'mean':>9}  n")
    print("-" * (width + 50))
    for stage in ("user_turn", "stream_chunks", "finalize_voice_analysis"):
        s = summary[stage]
        print(
            f"{stage:<{width}}  "
            f"{s['p50_ms']:>7.2f}ms  "
            f"{s['p95_ms']:>7.2f}ms  "
            f"{s['max_ms']:>7.2f}ms  "
            f"{s['mean_ms']:>7.2f}ms  "
            f"{s['n']}"
        )

    print(f"\n# machine-readable\n{json.dumps(summary)}")


if __name__ == "__main__":
    asyncio.run(main())
