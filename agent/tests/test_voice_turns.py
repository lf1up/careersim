"""Unit tests for the voice worker's turn aggregation (voice/turns.py).

Covers the abandon-and-rerun contract:

- utterances finalised within the debounce window compose ONE turn;
- a new utterance mid-generation aborts the in-flight stream and re-runs
  with the full buffer;
- the first durable reply acknowledges its user batch exactly once;
- an abort that raced an already-committed ``done`` reconciles against
  the persisted transcript instead of duplicating messages;
- teardown ``flush()`` persists uncommitted utterances via one final,
  unspoken turn;
- a TURN_CONFLICT from the API reconciles against the fresh transcript
  and retries only the still-uncommitted texts;
- re-runs carry the reconciled transcript length as an optimistic
  precondition (``expected_message_count``);
- turn lifecycle events (``superseded`` / ``committed``) fire for the
  client's caption grouping.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

import pytest

from careersim_agent.voice.state_bridge import TurnConflictError
from careersim_agent.voice.turns import TurnManager, _release_job_cancellation

# Short debounce so tests stay fast; long enough to compose rapid finals.
DEBOUNCE = 0.05


class ScriptedAPI:
    """Fake state_bridge.APIClient with per-call scripted stream behaviour.

    ``script`` holds one entry per expected ``stream_user_message`` call:

    - ``"reply"``: yield one message bubble then ``done``.
    - ``"hang"``: block forever (until the caller cancels the stream).
    - ``"conflict"``: raise :class:`TurnConflictError`.
    - ``"error_conflict"``: yield an SSE ``error`` event with the
      TURN_CONFLICT code (the post-headers conflict path).
    """

    def __init__(self, script: list[str]):
        self.script = list(script)
        self.calls: list[list[str]] = []
        # `expected_message_count` observed on each stream call, in order.
        self.preconditions: list[Any] = []
        self.done_count = 0
        # Wire-state returned by fetch_state_for_voice (reconciliation).
        self.state_response: dict[str, Any] = {"messages": []}

    async def fetch_state_for_voice(self, session_id: str) -> dict[str, Any]:
        return dict(self.state_response)

    async def stream_user_message(
        self,
        session_id: str,
        texts: list[str],
        *,
        expected_message_count: Any = None,
    ) -> AsyncIterator[dict[str, Any]]:
        self.calls.append(list(texts))
        self.preconditions.append(expected_message_count)
        behaviour = self.script.pop(0) if self.script else "reply"
        if behaviour == "hang":
            await asyncio.Event().wait()  # cancelled by the abandon path
        elif behaviour == "conflict":
            raise TurnConflictError("turn conflict")
        elif behaviour == "error_conflict":
            yield {
                "type": "error",
                "message": "Session was modified by a concurrent turn",
                "code": "TURN_CONFLICT",
            }
        else:
            yield {"type": "message", "content": f"reply:{'|'.join(texts)}"}
            self.done_count += 1
            yield {"type": "done"}


def _make_manager(
    api: ScriptedAPI, spoken: list[str], **overrides: Any
) -> TurnManager:
    async def speak(text: str) -> None:
        spoken.append(text)

    return TurnManager(
        session_id="sess-t",
        api=api,
        speak=speak,
        on_ai_bubble=lambda _b: None,
        speak_state={"turn_interrupted": False, "ai_audio_sec": 0.0, "interrupted": False},
        debounce_sec=overrides.pop("debounce_sec", DEBOUNCE),
        **overrides,
    )


async def _settle(mgr: TurnManager, timeout: float = 2.0) -> None:
    """Wait until the debounce fired and any in-flight turn finished."""
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        task = mgr._task
        debounce = mgr._debounce
        if (task is None or task.done()) and (debounce is None or debounce.done()):
            return
        await asyncio.sleep(0.01)
    raise TimeoutError("turn manager did not settle")


@pytest.mark.asyncio
async def test_finals_within_debounce_compose_one_turn() -> None:
    """Rapid utterances become ONE stream call carrying both texts."""
    api = ScriptedAPI(script=["reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)

    await mgr.on_final_text("first part")
    await mgr.on_final_text("second part")
    await _settle(mgr)

    assert api.calls == [["first part", "second part"]]
    assert spoken == ["reply:first part|second part"]
    # `done` committed the turn — the buffer is clear for the next one.
    assert mgr.pending_texts == []
    assert api.done_count == 1


@pytest.mark.asyncio
async def test_new_final_mid_stream_abandons_and_reruns() -> None:
    """An utterance during generation aborts the stream and re-runs with all texts."""
    api = ScriptedAPI(script=["hang", "reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)

    await mgr.on_final_text("message a")
    # Wait until the first (hanging) stream is actually in flight.
    for _ in range(100):
        if api.calls:
            break
        await asyncio.sleep(0.01)
    assert api.calls == [["message a"]]

    await mgr.on_final_text("message b")
    await _settle(mgr)

    # The re-run carried BOTH messages; the aborted call persisted nothing.
    assert api.calls == [["message a"], ["message a", "message b"]]
    assert spoken == ["reply:message a|message b"]
    assert mgr.pending_texts == []


@pytest.mark.asyncio
async def test_committed_turn_then_new_final_starts_fresh_turn() -> None:
    """After `done`, a new utterance is a NEW turn — not merged into the old one."""
    api = ScriptedAPI(script=["reply", "reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)

    await mgr.on_final_text("turn one")
    await _settle(mgr)
    await mgr.on_final_text("turn two")
    await _settle(mgr)

    assert api.calls == [["turn one"], ["turn two"]]
    assert api.done_count == 2


@pytest.mark.asyncio
async def test_abort_reconciles_against_committed_transcript() -> None:
    """If the abort raced an already-committed `done`, the re-run must not
    duplicate the committed texts."""
    api = ScriptedAPI(script=["hang", "reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)

    await mgr.on_final_text("committed one")
    for _ in range(100):
        if api.calls:
            break
        await asyncio.sleep(0.01)

    # Simulate the race: the server committed the first turn right before
    # the SSE was closed — the persisted transcript already has the text.
    api.state_response = {
        "messages": [
            {"role": "human", "content": "committed one"},
            {"role": "ai", "content": "some reply"},
        ]
    }
    await mgr.on_final_text("new text")
    await _settle(mgr)

    # Only the genuinely-uncommitted text was re-run, and the re-run
    # carried the reconciled transcript length as its precondition.
    assert api.calls == [["committed one"], ["new text"]]
    assert api.preconditions == [0, 2]


@pytest.mark.asyncio
async def test_abort_keeps_a_repeat_of_an_older_line() -> None:
    """A long session already containing the words just spoken must not eat them.

    Reconciliation used to drop any pending text that appeared anywhere in
    the recent human messages. Speaking over a reply in an old session then
    discarded the new utterance whenever it repeated an earlier line.
    """
    api = ScriptedAPI(script=["hang", "reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)
    api.state_response = {
        "messages": [
            {"role": "human", "content": "yeah"},
            {"role": "ai", "content": "go on"},
            {"role": "human", "content": "sounds good"},
            {"role": "ai", "content": "great"},
        ]
    }

    await mgr.on_final_text("message a")
    for _ in range(100):
        if api.calls:
            break
        await asyncio.sleep(0.01)

    await mgr.on_final_text("yeah")
    await _settle(mgr)

    assert api.calls == [["message a"], ["message a", "yeah"]]
    assert api.preconditions == [4, 4]


@pytest.mark.asyncio
async def test_cancelled_flush_still_persists_uncommitted_utterances() -> None:
    """LiveKit cancels the job 15s after the room drops.

    Production turns are often still streaming then. Cancelling the
    teardown flush must not drop the utterances that hadn't reached
    ``done`` — locally the same flush finishes before the cancel, which
    is why the loss only shows up in production.
    """
    api = ScriptedAPI(script=["hang", "reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken, debounce_sec=30.0, flush_timeout_sec=2.0)

    await mgr.on_final_text("the part production drops")
    flushing = asyncio.create_task(mgr.flush())
    for _ in range(100):
        if api.calls:
            break
        await asyncio.sleep(0.01)
    assert api.calls == [["the part production drops"]]
    assert api.done_count == 0

    flushing.cancel()
    await asyncio.wait([flushing])

    assert api.done_count == 1
    assert mgr.pending_texts == []
    assert api.calls[-1] == ["the part production drops"]
    assert spoken == []


@pytest.mark.asyncio
async def test_release_job_cancellation_outside_a_task() -> None:
    """A loop callback is not a Task. ``current_task()`` is None there."""
    loop = asyncio.get_running_loop()
    done: asyncio.Future[None] = loop.create_future()

    def _callback() -> None:
        _release_job_cancellation()
        done.set_result(None)

    loop.call_soon(_callback)
    await done


def test_release_job_cancellation_ignores_tasks_without_uncancel(monkeypatch) -> None:
    """Older loops have no ``uncancel``. Teardown must not crash on them."""
    monkeypatch.setattr(
        "careersim_agent.voice.turns.asyncio.current_task",
        lambda: object(),
    )
    _release_job_cancellation()


@pytest.mark.asyncio
async def test_cancelled_flush_stops_open_debounce_and_inflight_task() -> None:
    """A cancel mid-flush still drops the live debounce and in-flight turn."""
    api = ScriptedAPI(script=["reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken, debounce_sec=30.0)

    async def _cancelled() -> None:
        raise asyncio.CancelledError()

    mgr._flush_pending = _cancelled  # type: ignore[method-assign]
    mgr._debounce = asyncio.create_task(asyncio.sleep(30))
    started = asyncio.Event()

    async def _inflight() -> None:
        started.set()
        await asyncio.Event().wait()

    mgr._task = asyncio.create_task(_inflight())
    await started.wait()
    mgr.pending_texts = ["kept"]

    await mgr.flush()

    assert mgr._debounce.done()
    assert mgr._task.done()
    assert api.calls == [["kept"]]
    assert api.done_count == 1
    assert mgr.pending_texts == []
    assert spoken == []


@pytest.mark.asyncio
async def test_unspoken_tail_skips_empty_buffer_and_survives_failure() -> None:
    """Nothing buffered is a no-op; a failed final turn is logged, not raised."""
    api = ScriptedAPI(script=["hang"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken, flush_timeout_sec=0.05)

    await mgr._flush_unspoken_tail()
    assert api.calls == []

    mgr.pending_texts = ["nope"]
    await mgr._flush_unspoken_tail()
    assert api.calls == [["nope"]]
    assert api.done_count == 0
    assert mgr.pending_texts == ["nope"]


@pytest.mark.asyncio
async def test_flush_persists_uncommitted_utterances_without_speaking() -> None:
    """Teardown fires one final unspoken turn for anything still buffered."""
    api = ScriptedAPI(script=["reply"])
    spoken: list[str] = []
    # Huge debounce: the turn would never fire on its own before flush().
    mgr = _make_manager(api, spoken, debounce_sec=60.0)

    await mgr.on_final_text("last words")
    await mgr.flush()

    assert api.calls == [["last words"]]
    assert api.done_count == 1
    assert spoken == []  # flush drains for persistence only
    assert mgr.pending_texts == []


@pytest.mark.asyncio
async def test_turn_conflict_is_retried() -> None:
    """A 409 TURN_CONFLICT (pre-stream) reconciles and retries.

    Nothing of the batch is in the transcript here, so the retry carries
    the same texts — plus the freshly-observed transcript length as its
    precondition.
    """
    api = ScriptedAPI(script=["conflict", "reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)

    await mgr.on_final_text("hello")
    await _settle(mgr)

    assert api.calls == [["hello"], ["hello"]]
    assert api.preconditions == [0, 0]
    assert spoken == ["reply:hello"]


@pytest.mark.asyncio
async def test_turn_conflict_error_event_is_retried() -> None:
    """A TURN_CONFLICT delivered as an SSE error event also retries."""
    api = ScriptedAPI(script=["error_conflict", "reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)

    await mgr.on_final_text("hello")
    await _settle(mgr)

    assert api.calls == [["hello"], ["hello"]]
    assert api.done_count == 1


@pytest.mark.asyncio
async def test_conflict_retry_drops_texts_committed_by_aborted_stream() -> None:
    """The duplicate-transcript race: the abort of an in-flight turn loses
    to that turn's own server-side commit.

    Timeline: turn ["a"] is in flight; "b" arrives → abandon. The
    reconcile fetch still sees the transcript WITHOUT "a" (the aborted
    stream's persist hasn't committed yet), so the re-run carries
    ["a", "b"] with precondition 0. By persist time "a"+reply ARE
    committed → the API answers TURN_CONFLICT. The retry must reconcile
    against the now-durable transcript and re-send ONLY "b" — retrying
    the full batch blindly is exactly what duplicated messages before.
    """
    api = ScriptedAPI(script=["hang", "conflict", "reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)

    await mgr.on_final_text("a")
    for _ in range(100):
        if api.calls:
            break
        await asyncio.sleep(0.01)

    # Abandon-time reconcile still sees the pre-commit transcript.
    await mgr.on_final_text("b")
    # ...but by the time the re-run's persist would land, the aborted
    # stream's commit is durable:
    api.state_response = {
        "messages": [
            {"role": "human", "content": "a"},
            {"role": "ai", "content": "some reply"},
        ]
    }
    await _settle(mgr)

    assert api.calls == [["a"], ["a", "b"], ["b"]]
    # Re-run based on the stale (empty) transcript, retry on the fresh one.
    assert api.preconditions == [0, 0, 2]
    assert spoken == ["reply:b"]
    assert mgr.pending_texts == []


@pytest.mark.asyncio
async def test_conflict_with_everything_committed_skips_retry() -> None:
    """If the conflicted turn's texts are ALL already in the transcript
    (the aborted predecessor committed the whole batch), nothing is
    re-sent."""
    class CommitRaceAPI(ScriptedAPI):
        async def stream_user_message(self, session_id, texts, **kwargs):
            # The predecessor commits after this attempt read its baseline.
            self.state_response = {"messages": [
                {"role": "human", "content": "hello"},
                {"role": "ai", "content": "some reply"},
            ]}
            async for event in super().stream_user_message(session_id, texts, **kwargs):
                yield event

    api = CommitRaceAPI(script=["conflict"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)

    await mgr.on_final_text("hello")
    await _settle(mgr)

    assert api.calls == [["hello"]]
    assert mgr.pending_texts == []


@pytest.mark.asyncio
async def test_turn_lifecycle_events_fire() -> None:
    """`superseded` fires when an in-flight turn is abandoned, `committed`
    when a turn's `done` lands — the client groups live captions off
    these."""
    api = ScriptedAPI(script=["hang", "reply"])
    spoken: list[str] = []
    events: list[str] = []

    async def on_turn_event(kind: str) -> None:
        events.append(kind)

    mgr = _make_manager(api, spoken, on_turn_event=on_turn_event)

    await mgr.on_final_text("message a")
    for _ in range(100):
        if api.calls:
            break
        await asyncio.sleep(0.01)
    await mgr.on_final_text("message b")
    await _settle(mgr)

    assert events == ["superseded", "committed"]


@pytest.mark.asyncio
@pytest.mark.parametrize("finish", ["interrupt", "flush", "done"])
async def test_delivered_reply_commits_user_batch_before_done(finish: str) -> None:
    """A durable bubble acknowledges the humans once, even without done."""
    class DelayedAPI(ScriptedAPI):
        def __init__(self) -> None:
            super().__init__([])
            self.release = asyncio.Event()

        async def stream_user_message(self, session_id, texts, **kwargs):
            self.calls.append(list(texts))
            self.state_response["messages"].extend(
                {"role": "human", "content": text} for text in texts
            )
            reply = "reply:" + "|".join(texts)
            self.state_response["messages"].append({"role": "ai", "content": reply})
            yield {"type": "message", "content": reply}
            if len(self.calls) == 1:
                await self.release.wait()
            yield {"type": "done"}

    api = DelayedAPI()
    heard = asyncio.Event()
    spoken: list[str] = []
    async def speak(text):
        spoken.append(text)
        heard.set()
    mgr = _make_manager(api, spoken, flush_timeout_sec=0.02)
    mgr._speak = speak
    await mgr.on_final_text("first")
    await asyncio.wait_for(heard.wait(), 1)
    try:
        assert mgr.pending_texts == []
        if finish == "interrupt":
            await mgr.on_final_text("second")
            await _settle(mgr)
            assert api.calls == [["first"], ["second"]]
            assert spoken == ["reply:first", "reply:second"]
        elif finish == "flush":
            await mgr.flush()
            assert api.calls == [["first"]]
        else:
            # A later done must not remove words queued after the first bubble.
            mgr.pending_texts.append("second")
            api.release.set()
            await _settle(mgr)
            assert mgr.pending_texts == ["second"]
    finally:
        api.release.set()
        await mgr.flush()


@pytest.mark.asyncio
@pytest.mark.parametrize("resume", ["flush", "new_utterance"])
async def test_lost_reply_ack_reconciles_before_resending(resume: str) -> None:
    """A database commit can succeed even when its SSE message is lost."""
    class LostAckAPI(ScriptedAPI):
        async def stream_user_message(self, session_id, texts, **kwargs):
            if not self.calls:
                self.calls.append(list(texts))
                self.state_response = {"messages": [
                    {"role": "human", "content": "first"},
                    {"role": "ai", "content": "saved reply"},
                ]}
                raise ConnectionError("lost after commit")
            async for event in super().stream_user_message(session_id, texts, **kwargs):
                yield event

    api = LostAckAPI(["reply"])
    mgr = _make_manager(api, [])
    await mgr.on_final_text("first")
    await _settle(mgr)
    if resume == "new_utterance":
        await mgr.on_final_text("second")
        await _settle(mgr)
        assert api.calls == [["first"], ["second"]]
    else:
        await mgr.flush()
        assert api.calls == [["first"]]
    assert mgr.pending_texts == []


@pytest.mark.asyncio
async def test_flush_preserves_new_utterance_identical_to_previous_turn() -> None:
    api = ScriptedAPI(["hang", "reply"])
    api.state_response = {"messages": [
        {"role": "human", "content": "yes"},
        {"role": "ai", "content": "okay"},
    ]}
    mgr = _make_manager(api, [], flush_timeout_sec=0.02)
    await mgr.on_final_text("yes")
    for _ in range(100):
        if api.calls:
            break
        await asyncio.sleep(0.01)
    await mgr.flush()
    assert api.calls == [["yes"], ["yes"]]
    assert api.done_count == 1


@pytest.mark.asyncio
async def test_interrupt_during_baseline_fetch_keeps_all_unsent_words() -> None:
    class SlowReadAPI(ScriptedAPI):
        def __init__(self):
            super().__init__(["reply"])
            self.read_started = asyncio.Event()
            self.state_response = {"messages": [
                {"role": "human", "content": "yes"},
                {"role": "ai", "content": "okay"},
            ]}

        async def fetch_state_for_voice(self, session_id):
            if not self.read_started.is_set():
                self.read_started.set()
                await asyncio.Event().wait()
            return await super().fetch_state_for_voice(session_id)

    api = SlowReadAPI()
    mgr = _make_manager(api, [])
    await mgr.on_final_text("yes")
    await asyncio.wait_for(api.read_started.wait(), 1)
    await mgr.on_final_text("no")
    await _settle(mgr)
    assert api.calls == [["yes", "no"]]


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_before_request", [True, False])
async def test_state_read_failure_keeps_words_until_safe_retry(fail_before_request: bool) -> None:
    class FailingReadAPI(ScriptedAPI):
        fail_reads = True

        async def fetch_state_for_voice(self, session_id):
            if self.fail_reads and (fail_before_request or self.calls):
                raise ConnectionError("state unavailable")
            return await super().fetch_state_for_voice(session_id)

    api = FailingReadAPI(["reply"] if fail_before_request else ["conflict", "reply"])
    mgr = _make_manager(api, [])
    await mgr.on_final_text("keep me")
    await _settle(mgr)
    assert api.calls == ([] if fail_before_request else [["keep me"]])
    assert mgr.pending_texts == ["keep me"]
    api.fail_reads = False
    await mgr.flush()
    assert api.done_count == 1
    assert mgr.pending_texts == []


@pytest.mark.asyncio
@pytest.mark.parametrize("saved", [True, False, None])
async def test_teardown_rechecks_uncertain_commit_after_state_read_failure(saved: bool | None) -> None:
    """Retry only unsaved speech after a lost acknowledgement and failed read."""
    class UncertainCommitAPI(ScriptedAPI):
        reconcile_reads = 0

        async def stream_user_message(self, session_id, texts, **kwargs):
            if not self.calls:
                self.calls.append(list(texts))
                if saved:
                    self.state_response = {"messages": [
                        {"role": "human", "content": "keep me"},
                        {"role": "ai", "content": "already saved"},
                    ]}
                raise ConnectionError("reply acknowledgement lost")
            async for event in super().stream_user_message(session_id, texts, **kwargs):
                yield event

        async def fetch_state_for_voice(self, session_id):
            if self.calls:
                self.reconcile_reads += 1
                if self.reconcile_reads == 1 or saved is None:
                    raise ConnectionError("state temporarily unavailable")
            return await super().fetch_state_for_voice(session_id)

    api = UncertainCommitAPI(["reply"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)
    await mgr.on_final_text("keep me")
    await _settle(mgr)
    await mgr.flush()

    if saved is False:
        assert api.calls == [["keep me"], ["keep me"]]
        assert api.done_count == 1
    else:
        assert api.calls == [["keep me"]]
    assert mgr.pending_texts == (["keep me"] if saved is None else [])
    assert spoken == []
