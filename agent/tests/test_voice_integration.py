"""End-to-end integration tests for the agent-side voice pipeline.

These wire LangGraphAdapter, fake STT/TTS providers, the caption
publisher protocol, and a fake APIClient together to exercise the
full per-call flow without LiveKit:

  bootstrap state -> opening turn -> N user turns
                  -> chunk-streamed TTS -> caption publish
                  -> per-turn voice metadata recording
                  -> finalize_voice_analysis -> report_call_end

The fakes are deliberately minimal — they record method calls so
the test asserts the orchestration order, not provider quality.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from careersim_agent.services.eval_service import VoiceTurnMetadata
from careersim_agent.voice.persona_voice import VoiceTuning, resolve_voice_tuning
from careersim_agent.voice.pipeline import LangGraphAdapter, stream_chunks
from careersim_agent.voice.providers.base import STTResult, TTSAudioChunk
from careersim_agent.voice.transcripts import Caption


# -----------------------------------------------------------------
# Fakes
# -----------------------------------------------------------------


@dataclass
class FakeConversationService:
    next_replies: list[str] = field(default_factory=list)
    invoked: list[tuple[str, str]] = field(default_factory=list)

    def invoke_turn(self, state: dict[str, Any], user_message: str) -> dict[str, Any]:
        reply = self.next_replies.pop(0) if self.next_replies else "ok"
        self.invoked.append(("turn", user_message))
        out = dict(state)
        out["messages"] = list(state.get("messages") or []) + [
            HumanMessage(content=user_message),
            AIMessage(content=reply),
        ]
        return out

    def invoke_proactive(
        self, state: dict[str, Any], trigger: str
    ) -> dict[str, Any]:
        reply = self.next_replies.pop(0) if self.next_replies else "Hello!"
        self.invoked.append(("proactive", trigger))
        out = dict(state)
        out["messages"] = list(state.get("messages") or []) + [
            AIMessage(content=reply),
        ]
        return out


@dataclass
class FakeSTT:
    """STT that yields a canned `STTResult` per `transcribe_chunk`."""

    queued: list[str] = field(default_factory=list)
    closed: bool = False

    async def transcribe_chunk(
        self, audio_pcm16: bytes, *, sample_rate: int = 16000
    ) -> Optional[STTResult]:
        if not self.queued:
            return None
        text = self.queued.pop(0)
        return STTResult(text=text, is_final=True)

    async def aclose(self) -> None:
        self.closed = True


@dataclass
class FakeTTS:
    """TTS that yields a single fake PCM chunk per text chunk."""

    synthesised: list[str] = field(default_factory=list)
    closed: bool = False

    async def synthesize(self, text: str) -> AsyncIterator[TTSAudioChunk]:
        self.synthesised.append(text)
        yield TTSAudioChunk(
            audio=b"\x00\x00" * 1024,
            sample_rate=22050,
            is_final=True,
        )

    async def aclose(self) -> None:
        self.closed = True


@dataclass
class FakeCaptions:
    published: list[Caption] = field(default_factory=list)

    async def publish(self, caption: Caption) -> None:
        self.published.append(caption)


@dataclass
class FakeAPI:
    """In-memory stand-in for state_bridge.APIClient."""

    state_response: dict[str, Any] = field(default_factory=dict)
    user_messages: list[tuple[str, str]] = field(default_factory=list)
    end_reports: list[tuple[str, int, Optional[dict[str, Any]]]] = field(
        default_factory=list
    )

    async def fetch_state_for_voice(self, session_id: str) -> dict[str, Any]:
        return dict(self.state_response)

    async def post_user_message(
        self, session_id: str, user_text: str, *, bearer_token: str
    ) -> dict[str, Any]:
        self.user_messages.append((session_id, user_text))
        return {"id": "msg-fake", "content": user_text}

    async def report_call_end(
        self,
        session_id: str,
        seconds_used: int,
        *,
        bearer_token: str,
        voice_analysis: Optional[dict[str, Any]] = None,
    ) -> None:
        self.end_reports.append((session_id, seconds_used, voice_analysis))

    async def aclose(self) -> None:
        pass


# -----------------------------------------------------------------
# Coordinator: a thin imitation of what _run_room_session will do
#
# The production worker hands off audio routing to the LiveKit
# Agents SDK (`AgentSession`); here we drive the adapter manually
# with the fake providers so the integration test stays SDK-free
# while still exercising the contract: STT → adapter.user_turn →
# TTS chunk-stream → captions → metadata recording.
# -----------------------------------------------------------------


async def _run_call(
    adapter: LangGraphAdapter,
    stt: FakeSTT,
    tts: FakeTTS,
    captions: FakeCaptions,
    api: FakeAPI,
    session_id: str,
    bearer_token: str,
    *,
    audio_starts: list[float],
    audio_ends: list[float],
) -> None:
    """Drive one call's worth of turns through the adapter.

    `audio_starts/ends` are paired wall-clock timings — one per
    user utterance — the test uses to feed `record_voice_turn`.
    """
    # Opening turn.
    opening = await adapter.opening_turn()
    if opening is not None and opening.text:
        await captions.publish(Caption(role="ai", text=opening.text, is_final=True))
        async for chunk in stream_chunks(opening.text):
            async for _audio in tts.synthesize(chunk):
                pass
        adapter.record_voice_turn(
            VoiceTurnMetadata(
                role="ai",
                transcript=opening.text,
                audio_start_sec=0.0,
                audio_end_sec=1.5,
            )
        )

    # User turns: pull each transcript from the fake STT in order.
    last_audio_end = 1.5 if opening else 0.0
    while stt.queued or audio_starts:
        result = await stt.transcribe_chunk(b"")
        if result is None:
            break
        start = audio_starts.pop(0)
        end = audio_ends.pop(0)
        adapter.record_voice_turn(
            VoiceTurnMetadata(
                role="human",
                transcript=result.text,
                audio_start_sec=start,
                audio_end_sec=end,
                prior_turn_ended_sec=last_audio_end,
            )
        )
        await api.post_user_message(
            session_id, result.text, bearer_token=bearer_token
        )

        turn = await adapter.user_turn(result.text)
        await captions.publish(Caption(role="ai", text=turn.text, is_final=True))
        async for chunk in stream_chunks(turn.text):
            async for _audio in tts.synthesize(chunk):
                pass
        adapter.record_voice_turn(
            VoiceTurnMetadata(
                role="ai",
                transcript=turn.text,
                audio_start_sec=end + 0.3,
                audio_end_sec=end + 1.8,
            )
        )
        last_audio_end = end + 1.8

    # Teardown: finalize + persist.
    analysis = adapter.finalize_voice_analysis().get("voice")
    await api.report_call_end(
        session_id,
        seconds_used=int(last_audio_end),
        bearer_token=bearer_token,
        voice_analysis=analysis,
    )
    await stt.aclose()
    await tts.aclose()


# -----------------------------------------------------------------
# Tests
# -----------------------------------------------------------------


def _vikram_state() -> dict[str, Any]:
    return {
        "session_id": "sess-int",
        "messages": [],
        "persona": {
            "slug": "vikram-shah-pipeline-recruiter",
            "name": "Vikram",
            "voice": {
                "speakingRateWpm": 135,
                "silenceThresholdMs": 30000,
                "bargeInToleranceMs": 200,
                "fillerWordFrequency": "medium",
                "providers": {
                    "piper_local": {"voiceModel": "en_US-ryan-high"},
                },
            },
        },
        "proactive_trigger": "start",
        "proactive_count": 0,
    }


@pytest.mark.asyncio
async def test_full_call_flow_round_trips_state_and_captions() -> None:
    svc = FakeConversationService(
        next_replies=[
            "Hey! Thanks for jumping on. So tell me about yourself.",
            "Got it — and what kind of comp range are you targeting?",
            "Sure, I can dig into that. Talk soon!",
        ]
    )
    adapter = LangGraphAdapter(_vikram_state(), service=svc)

    stt = FakeSTT(queued=["I'm a senior engineer", "Around 240k base"])
    tts = FakeTTS()
    captions = FakeCaptions()
    api = FakeAPI()

    await _run_call(
        adapter,
        stt,
        tts,
        captions,
        api,
        session_id="sess-int",
        bearer_token="user-bearer-xyz",
        audio_starts=[2.0, 8.0],
        audio_ends=[3.5, 9.5],
    )

    # 1. Captions: opening + each AI reply published as final.
    final_captions = [c for c in captions.published if c.is_final]
    assert len(final_captions) == 3
    assert all(c.role == "ai" for c in final_captions)

    # 2. TTS got every reply chunked through stream_chunks.
    assert len(tts.synthesised) >= 3
    assert any("Thanks for jumping on" in s for s in tts.synthesised)

    # 3. User messages were forwarded to the API with the bearer.
    assert api.user_messages == [
        ("sess-int", "I'm a senior engineer"),
        ("sess-int", "Around 240k base"),
    ]

    # 4. Call-end report carries the voice analysis we computed.
    assert len(api.end_reports) == 1
    sid, secs, analysis = api.end_reports[0]
    assert sid == "sess-int"
    assert secs > 0
    assert analysis is not None
    # ai_speaking_time + user_speaking_time should be > 0; we
    # recorded both sides in record_voice_turn.
    assert analysis["ai_speaking_time_sec"] > 0
    assert analysis["user_speaking_time_sec"] > 0
    assert len(analysis["turns"]) >= 4  # 1 opening + 2*(user+ai)

    # 5. Providers cleaned up.
    assert stt.closed
    assert tts.closed


@pytest.mark.asyncio
async def test_full_call_flow_persona_without_voice_block_still_runs() -> None:
    """Personas with no `voice` block should still finish a call.

    The adapter doesn't gate on persona_supports_voice — that's the
    API service's job at /voice/start. If a worker somehow ends up
    in a room for a voice-ineligible persona, the pipeline should
    degrade gracefully rather than crash.
    """
    svc = FakeConversationService(next_replies=["Yeah, sure."])
    state = {
        "session_id": "sess-no-voice",
        "messages": [],
        "persona": {"slug": "minimal", "name": "Minimal"},
        "proactive_trigger": None,
        "proactive_count": 0,
    }
    adapter = LangGraphAdapter(state, service=svc)

    stt = FakeSTT(queued=["hi"])
    tts = FakeTTS()
    captions = FakeCaptions()
    api = FakeAPI()

    await _run_call(
        adapter,
        stt,
        tts,
        captions,
        api,
        session_id="sess-no-voice",
        bearer_token="t",
        audio_starts=[0.5],
        audio_ends=[1.0],
    )

    assert api.user_messages == [("sess-no-voice", "hi")]
    assert api.end_reports
    _, _, analysis = api.end_reports[0]
    assert analysis is not None  # signals always emitted, even minimal


@pytest.mark.asyncio
async def test_voice_tuning_resolves_for_every_shipping_persona() -> None:
    """Smoke check: every persona in the JSON is voice-call-ready.

    Cross-cutting integration check — Phase-6 added the voice block
    to all 9 personas; this test asserts the shipping JSON keeps
    that contract so Phase-7 ships green.
    """
    import json
    from pathlib import Path

    personas = json.loads(
        (Path(__file__).parent.parent / "data" / "personas.json").read_text()
    )
    for persona in personas:
        tuning = resolve_voice_tuning(persona)
        assert isinstance(tuning, VoiceTuning), persona["slug"]
        assert tuning.barge_in_tolerance_ms > 0, persona["slug"]


@pytest.mark.asyncio
async def test_call_end_report_carries_call_duration_and_analysis() -> None:
    """The call-end report must include both duration and analytics.

    Regression guard for the contract between worker teardown and the
    API quota debit: we can't drop either field silently.
    """
    svc = FakeConversationService(next_replies=["yes"])
    adapter = LangGraphAdapter(_vikram_state(), service=svc)

    api = FakeAPI()
    stt = FakeSTT(queued=["hello there"])

    await _run_call(
        adapter,
        stt,
        FakeTTS(),
        FakeCaptions(),
        api,
        session_id="sess-dur",
        bearer_token="t",
        audio_starts=[2.0],
        audio_ends=[3.0],
    )

    assert len(api.end_reports) == 1
    _, secs_used, analysis = api.end_reports[0]
    assert secs_used >= 1
    assert analysis is not None
    # The aggregate must include the contract fields the feedback
    # view depends on. If you drop one of these, the UI breaks.
    expected = {
        "user_avg_wpm",
        "ai_avg_wpm",
        "user_filler_count",
        "user_filler_density_per_100w",
        "user_avg_response_latency_sec",
        "longest_silence_sec",
        "user_interrupt_count",
        "ai_interrupt_count",
        "user_speaking_time_sec",
        "ai_speaking_time_sec",
        "warnings",
        "turns",
    }
    assert expected.issubset(set(analysis.keys()))
