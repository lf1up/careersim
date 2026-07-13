"""Unit tests for the voice worker's turn aggregation (voice/turns.py).

Covers the abandon-and-rerun contract:

- utterances finalised within the debounce window compose ONE turn;
- a new utterance mid-generation aborts the in-flight stream and re-runs
  with the full buffer;
- the buffer clears only on the stream's terminal ``done``;
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
from careersim_agent.voice.turns import TurnManager

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
        bearer_token: str,
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
        bearer_token="tok",
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
    assert api.preconditions == [None, 2]


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
    assert api.preconditions == [None, 0]
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
    assert api.preconditions == [None, 0, 2]
    assert spoken == ["reply:b"]
    assert mgr.pending_texts == []


@pytest.mark.asyncio
async def test_conflict_with_everything_committed_skips_retry() -> None:
    """If the conflicted turn's texts are ALL already in the transcript
    (the aborted predecessor committed the whole batch), nothing is
    re-sent."""
    api = ScriptedAPI(script=["conflict"])
    spoken: list[str] = []
    mgr = _make_manager(api, spoken)
    api.state_response = {
        "messages": [
            {"role": "human", "content": "hello"},
            {"role": "ai", "content": "some reply"},
        ]
    }

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
