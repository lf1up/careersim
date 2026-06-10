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
    controls: list[dict[str, Any]] = field(default_factory=list)

    async def publish(self, caption: Caption) -> None:
        self.published.append(caption)

    async def publish_control(self, payload: dict[str, Any]) -> None:
        self.controls.append(payload)


@dataclass
class FakeAPI:
    """In-memory stand-in for state_bridge.APIClient.

    ``stream_user_message`` mirrors the production SSE contract: for each
    user turn it pops the next list of reply bubbles from ``reply_bubbles``
    and yields one ``message`` event per bubble, then a terminal ``done``.
    ``done_count`` lets tests assert the stream was drained to completion
    (the persistence guarantee) even when the speaker stops early.
    """

    state_response: dict[str, Any] = field(default_factory=dict)
    user_messages: list[tuple[str, str]] = field(default_factory=list)
    reply_bubbles: list[list[str]] = field(default_factory=list)
    done_count: int = 0
    end_reports: list[tuple[str, int, Optional[dict[str, Any]]]] = field(
        default_factory=list
    )

    budget_response: dict[str, Any] = field(
        default_factory=lambda: {"remaining_seconds": None, "cap_seconds": None}
    )

    async def fetch_state_for_voice(self, session_id: str) -> dict[str, Any]:
        return dict(self.state_response)

    async def fetch_voice_budget(self, session_id: str) -> dict[str, Any]:
        return dict(self.budget_response)

    async def stream_user_message(
        self, session_id: str, user_text: str, *, bearer_token: str
    ) -> AsyncIterator[dict[str, Any]]:
        self.user_messages.append((session_id, user_text))
        bubbles = self.reply_bubbles.pop(0) if self.reply_bubbles else ["ok"]
        for i, bubble in enumerate(bubbles):
            yield {"type": "message", "content": bubble, "is_followup": i > 0}
        self.done_count += 1
        yield {"type": "done"}

    async def report_call_end(
        self,
        session_id: str,
        seconds_used: int,
        *,
        voice_analysis: Optional[dict[str, Any]] = None,
    ) -> None:
        # Authoritative end is internal-key authenticated — no bearer.
        self.end_reports.append((session_id, seconds_used, voice_analysis))

    async def aclose(self) -> None:
        pass


# -----------------------------------------------------------------
# Coordinator: a thin imitation of what _run_room_session will do
#
# The production worker hands off audio routing to the LiveKit
# Agents SDK (`AgentSession`); here we drive the flow manually with
# the fake providers so the integration test stays SDK-free while
# still exercising the streaming contract: STT → opening burst
# bubbles → per-user-turn `api.stream_user_message` → speak each
# streamed reply bubble (TTS chunk-stream + caption) → metadata
# recording.
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
    """Drive one call's worth of turns through the streaming flow.

    `audio_starts/ends` are paired wall-clock timings — one per
    user utterance — the test uses to feed `record_voice_turn`.
    """
    # Opening turn — only when the loaded transcript is empty. If the
    # persona already opened via the text API (the opening is persisted),
    # the worker stays silent rather than speaking a second, unsaved
    # opening. Mirrors the guard in `_run_room_session`.
    existing_messages = adapter.current_state_wire().get("messages") or []
    opening = None if existing_messages else await adapter.opening_turn()
    if opening is not None and opening.text:
        for bubble in opening.burst_messages or [opening.text]:
            await captions.publish(Caption(role="ai", text=bubble, is_final=True))
            async for chunk in stream_chunks(bubble):
                async for _audio in tts.synthesize(chunk):
                    pass
            adapter.record_voice_turn(
                VoiceTurnMetadata(
                    role="ai",
                    transcript=bubble,
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

        # Stream the reply and speak each bubble as it arrives.
        bubble_offset = 0.0
        async for event in api.stream_user_message(
            session_id, result.text, bearer_token=bearer_token
        ):
            if event["type"] != "message":
                continue
            bubble = event["content"]
            await captions.publish(Caption(role="ai", text=bubble, is_final=True))
            async for chunk in stream_chunks(bubble):
                async for _audio in tts.synthesize(chunk):
                    pass
            adapter.record_voice_turn(
                VoiceTurnMetadata(
                    role="ai",
                    transcript=bubble,
                    audio_start_sec=end + 0.3 + bubble_offset,
                    audio_end_sec=end + 1.8 + bubble_offset,
                )
            )
            bubble_offset += 1.5
            last_audio_end = end + 1.8 + bubble_offset

    # Teardown: finalize + persist.
    analysis = adapter.finalize_voice_analysis().get("voice")
    await api.report_call_end(
        session_id,
        seconds_used=int(last_audio_end),
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
    # Opening line comes from the adapter (local proactive); the two user
    # replies are streamed back by the (fake) API, one bubble each.
    svc = FakeConversationService(
        next_replies=["Hey! Thanks for jumping on. So tell me about yourself."]
    )
    adapter = LangGraphAdapter(_vikram_state(), service=svc)

    stt = FakeSTT(queued=["I'm a senior engineer", "Around 240k base"])
    tts = FakeTTS()
    captions = FakeCaptions()
    api = FakeAPI(
        reply_bubbles=[
            ["Got it — and what kind of comp range are you targeting?"],
            ["Sure, I can dig into that. Talk soon!"],
        ]
    )

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

    # 3. User messages were forwarded to the API with the bearer, and each
    #    reply stream was drained to its terminal `done` (persistence ran).
    assert api.user_messages == [
        ("sess-int", "I'm a senior engineer"),
        ("sess-int", "Around 240k base"),
    ]
    assert api.done_count == 2

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
async def test_no_duplicate_opening_when_transcript_already_has_one() -> None:
    """Regression: a persona that already opened in text must not re-open.

    When the session was created via the text API, the persona's opening is
    persisted and the loaded snapshot still carries `proactive_trigger ==
    'start'`. The worker must NOT generate/speak a second (unsaved) opening
    — it stays silent and waits for the user. Here the loaded state already
    contains the opening AI message, so no opening should be spoken even
    though `proactive_trigger` is still 'start'.
    """
    svc = FakeConversationService(next_replies=["(should never be used)"])
    state = _vikram_state()
    # The opening is already persisted (as it would be after /sessions
    # create). The adapter takes wire-format messages (plain dicts) and
    # deserializes them internally.
    state["messages"] = [{"role": "ai", "content": "Hey! Saw your profile — got a sec?"}]
    adapter = LangGraphAdapter(state, service=svc)

    stt = FakeSTT(queued=["yes, go ahead"])
    tts = FakeTTS()
    captions = FakeCaptions()
    api = FakeAPI(reply_bubbles=[["Great — let's dive in."]])

    await _run_call(
        adapter,
        stt,
        tts,
        captions,
        api,
        session_id="sess-reopen",
        bearer_token="t",
        audio_starts=[1.0],
        audio_ends=[2.0],
    )

    # The persona must not have re-spoken its opening line.
    ai_caption_texts = [c.text for c in captions.published if c.role == "ai"]
    assert "Hey! Saw your profile — got a sec?" not in ai_caption_texts
    # The proactive opening service path was never invoked.
    assert not any(kind == "proactive" for kind, _ in svc.invoked)
    # Only the streamed reply to the user's turn was spoken.
    assert ai_caption_texts == ["Great — let's dive in."]


@pytest.mark.asyncio
async def test_streamed_followup_bubbles_are_each_spoken_separately() -> None:
    """A multi-bubble reply (main + follow-up bursts) is spoken bubble-by-bubble.

    This is the core UX win of the streaming path: rather than joining the
    whole burst into one utterance, each streamed bubble gets its own
    caption, TTS pass, and per-turn voice metadata record.
    """
    svc = FakeConversationService(next_replies=["Welcome aboard!"])
    adapter = LangGraphAdapter(_vikram_state(), service=svc)

    stt = FakeSTT(queued=["sounds good"])
    tts = FakeTTS()
    captions = FakeCaptions()
    api = FakeAPI(
        reply_bubbles=[
            ["First, the main reply.", "Oh — and one more thing.", "Talk soon!"],
        ]
    )

    await _run_call(
        adapter,
        stt,
        tts,
        captions,
        api,
        session_id="sess-burst",
        bearer_token="t",
        audio_starts=[1.0],
        audio_ends=[2.0],
    )

    final_captions = [c.text for c in captions.published if c.is_final]
    # 1 opening bubble + 3 streamed reply bubbles, each published separately.
    assert final_captions == [
        "Welcome aboard!",
        "First, the main reply.",
        "Oh — and one more thing.",
        "Talk soon!",
    ]
    # Each bubble was synthesised on its own (not joined with " … ").
    assert "First, the main reply." in tts.synthesised
    assert "Oh — and one more thing." in tts.synthesised
    assert "Talk soon!" in tts.synthesised
    assert not any(" … " in s for s in tts.synthesised)
    assert api.done_count == 1


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
    api = FakeAPI(reply_bubbles=[["Yeah, sure."]])

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

    api = FakeAPI(reply_bubbles=[["yes"]])
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
