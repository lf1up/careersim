"""Voice worker paths that don't need a running LiveKit server.

``run_worker`` stops at config checks in the other module. These tests
fake the Agents / RTC imports (they happen inside the functions) and
drive session bootstrap, playback, barge-in, the budget watchdog, and
teardown.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import types
from typing import Any

import pytest

from careersim_agent import config as config_module
from careersim_agent.voice.persona_voice import VoiceTuning
from careersim_agent.voice.pipeline import LangGraphAdapter, TurnResult
from careersim_agent.voice.providers.base import STTResult
from careersim_agent.voice.turns import TurnManager
from careersim_agent.voice.worker import (
    _resolve_session_metadata,
    _run_room_session,
    _voice_entrypoint,
    main,
    run_worker,
)


def _reset_settings() -> None:
    config_module.get_settings.cache_clear()


@pytest.fixture
def fast_sleep(monkeypatch: pytest.MonkeyPatch):
    """Collapse the worker's poll / watchdog sleeps without spinning."""
    real = asyncio.sleep

    async def sleep(delay: float = 0) -> None:
        if delay >= 1000:
            await asyncio.Event().wait()
        await real(0)

    monkeypatch.setattr(asyncio, "sleep", sleep)
    return real


@pytest.fixture
def fast_turns(monkeypatch: pytest.MonkeyPatch):
    original = TurnManager.__init__

    def __init__(self: TurnManager, *args: Any, **kwargs: Any) -> None:
        kwargs["debounce_sec"] = 0
        kwargs["flush_timeout_sec"] = 1
        kwargs["first_bubble_soft_timeout_sec"] = 30
        original(self, *args, **kwargs)

    monkeypatch.setattr(TurnManager, "__init__", __init__)


class _Kit:
    def __init__(self) -> None:
        self.audio_script: Any = None
        self.vad_script: Any = None
        self.vad_kwargs: dict[str, Any] | None = None
        self.sources: list[Any] = []
        self.pushed_frames: list[Any] = []
        self.resamplers: list[tuple[int, int]] = []
        self.clear_fails = False
        self.audio_fail_close = False
        self.vad_fail_close = False
        self.source_fail_close = False


def _install_livekit(monkeypatch: pytest.MonkeyPatch) -> _Kit:
    kit = _Kit()

    class AudioFrame:
        def __init__(
            self,
            data: bytes,
            sample_rate: int,
            num_channels: int,
            samples_per_channel: int,
        ) -> None:
            self.data = data
            self.sample_rate = sample_rate
            self.num_channels = num_channels
            self.samples_per_channel = samples_per_channel

    class AudioResampler:
        def __init__(self, in_rate: int, out_rate: int, num_channels: int = 1) -> None:
            kit.resamplers.append((in_rate, out_rate))

        def push(self, frame: AudioFrame) -> list[AudioFrame]:
            return [AudioFrame(frame.data, 48000, 1, frame.samples_per_channel)]

        def flush(self) -> list[AudioFrame]:
            return [AudioFrame(b"\x00\x00", 48000, 1, 1)]

    class AudioSource:
        def __init__(self, rate: int, channels: int) -> None:
            self.rate = rate
            self.channels = channels
            self.frames: list[AudioFrame] = []
            kit.sources.append(self)

        async def capture_frame(self, frame: AudioFrame) -> None:
            self.frames.append(frame)

        async def wait_for_playout(self) -> None:
            return None

        def clear_queue(self) -> None:
            if kit.clear_fails:
                raise RuntimeError("clear")

        async def aclose(self) -> None:
            if kit.source_fail_close:
                raise RuntimeError("source")

    class LocalAudioTrack:
        @staticmethod
        def create_audio_track(name: str, source: AudioSource) -> Any:
            return types.SimpleNamespace(name=name, source=source)

    class TrackPublishOptions:
        def __init__(self, source: Any = None) -> None:
            self.source = source

    class TrackSource:
        SOURCE_MICROPHONE = "microphone"

    class TrackKind:
        KIND_AUDIO = "audio"

    class AudioStream:
        def __init__(self, track: Any, sample_rate: int, num_channels: int) -> None:
            self.track = track
            self.sample_rate = sample_rate

        def __aiter__(self) -> Any:
            return kit.audio_script()

        async def aclose(self) -> None:
            if kit.audio_fail_close:
                raise RuntimeError("audio")

    class VADEventType:
        START_OF_SPEECH = "start"
        END_OF_SPEECH = "end"

    class _VADStream:
        def push_frame(self, frame: Any) -> None:
            kit.pushed_frames.append(frame)

        def __aiter__(self) -> Any:
            return kit.vad_script()

        async def aclose(self) -> None:
            if kit.vad_fail_close:
                raise RuntimeError("vad")

    class _VAD:
        @staticmethod
        def load(**kwargs: Any) -> Any:
            kit.vad_kwargs = kwargs
            return types.SimpleNamespace(stream=_VADStream)

    def put(name: str, **attrs: Any) -> types.ModuleType:
        mod = types.ModuleType(name)
        mod.__path__ = []  # type: ignore[attr-defined]
        for key, value in attrs.items():
            setattr(mod, key, value)
        monkeypatch.setitem(sys.modules, name, mod)
        return mod

    livekit = put("livekit")
    rtc = put(
        "livekit.rtc",
        AudioFrame=AudioFrame,
        AudioResampler=AudioResampler,
        AudioSource=AudioSource,
        LocalAudioTrack=LocalAudioTrack,
        TrackPublishOptions=TrackPublishOptions,
        TrackSource=TrackSource,
        TrackKind=TrackKind,
        AudioStream=AudioStream,
    )
    agents = put("livekit.agents")
    vad_mod = put("livekit.agents.vad", VADEventType=VADEventType)
    plugins = put("livekit.plugins")
    silero = put("livekit.plugins.silero", VAD=_VAD)
    livekit.rtc = rtc
    livekit.agents = agents
    agents.vad = vad_mod
    livekit.plugins = plugins
    plugins.silero = silero
    return kit


class _Participant:
    def __init__(self) -> None:
        self.data: list[tuple[bytes, str, bool]] = []
        self.tracks: list[Any] = []

    async def publish_data(self, payload: bytes, *, topic: str, reliable: bool) -> None:
        self.data.append((payload, topic, reliable))

    async def publish_track(self, track: Any, options: Any) -> None:
        self.tracks.append((track, options))


class _Room:
    def __init__(self) -> None:
        self.name = "room-1"
        self.metadata: str | None = None
        self.remote_participants: Any = {}
        self.handlers: dict[str, Any] = {}
        self.local_participant = _Participant()

    def on(self, event: str, callback: Any) -> None:
        self.handlers[event] = callback


class _Ctx:
    def __init__(self, room: _Room, *, shutdown: bool = True) -> None:
        self.room = room
        self.connected = False
        self.callbacks: list[Any] = []
        self._shutdown = shutdown

    async def connect(self) -> None:
        self.connected = True

    def add_shutdown_callback(self, callback: Any) -> None:
        self.callbacks.append(callback)

    def expose(self) -> Any:
        if self._shutdown:
            return self
        return types.SimpleNamespace(room=self.room)


class _Captions:
    def __init__(self) -> None:
        self.published: list[Any] = []
        self.controls: list[dict[str, Any]] = []
        self.fail = False
        self.release: asyncio.Event | None = None

    async def publish(self, caption: Any) -> None:
        self.published.append(caption)

    async def publish_control(self, payload: dict[str, Any]) -> None:
        self.controls.append(dict(payload))
        if payload.get("type") == "quota_warning" and self.release is not None:
            self.release.set()
        if self.fail:
            raise RuntimeError("control down")


class _TTS:
    def __init__(
        self,
        rate: int = 22050,
        *,
        fail: bool = False,
        block: asyncio.Event | None = None,
    ) -> None:
        self._rate = rate
        self.fail = fail
        self.block = block
        self.texts: list[str] = []
        self.started = asyncio.Event()
        self.closed = False

    def output_sample_rate(self) -> int:
        return self._rate

    async def synthesize(self, text: str):
        self.texts.append(text)
        self.started.set()
        if self.fail:
            raise RuntimeError("synth failed")
        yield types.SimpleNamespace(audio=b"\x01\x00" * 4)
        if self.block is not None and not self.block.is_set():
            await self.block.wait()
        yield types.SimpleNamespace(audio=b"")
        yield types.SimpleNamespace(audio=b"\x00")

    async def aclose(self) -> None:
        self.closed = True


class _STT:
    def __init__(self, script: list[Any] | None = None, *, hang: bool = False) -> None:
        self.script = list(script or [])
        self.hang = hang
        self.closed = False

    def input_sample_rate(self) -> int:
        return 16000

    async def transcribe(self, frames: Any):
        async for _chunk in frames:
            pass
        if self.hang:
            await asyncio.Event().wait()
        item = self.script.pop(0)
        if isinstance(item, BaseException):
            raise item
        for result in item:
            yield result

    async def aclose(self) -> None:
        self.closed = True


class _API:
    def __init__(self) -> None:
        self.streams: list[list[str]] = []
        self.closed = False
        self.state: dict[str, Any] | None = {"messages": []}
        self.budget: Any = {"remaining_seconds": 120, "cap_seconds": 600}
        self.budget_error: BaseException | None = None
        self.state_error: BaseException | None = None
        self.report_error: BaseException | None = None
        self.reported: tuple[Any, ...] | None = None

    async def fetch_state_for_voice(self, session_id: str) -> dict[str, Any]:
        if self.state_error:
            raise self.state_error
        return {"messages": [], "session_id": session_id}

    async def fetch_voice_budget(self, session_id: str) -> Any:
        if self.budget_error:
            raise self.budget_error
        return self.budget

    async def stream_user_message(
        self,
        session_id: str,
        texts: list[str],
        expected_message_count: int | None = None,
    ):
        self.streams.append(list(texts))
        yield {"type": "message", "content": "Sure."}
        yield {"type": "message", "content": "   "}
        yield {"type": "done"}

    async def report_call_end(
        self,
        session_id: str,
        elapsed: int,
        voice_analysis: dict[str, Any] | None = None,
    ) -> None:
        if self.report_error:
            raise self.report_error
        self.reported = (session_id, elapsed, voice_analysis)

    async def aclose(self) -> None:
        self.closed = True


class _Adapter(LangGraphAdapter):
    def __init__(
        self,
        *,
        messages: list[dict[str, Any]] | None = None,
        opening: TurnResult | None = None,
        persona: dict[str, Any] | None = None,
    ) -> None:
        super().__init__({
            "session_id": "sess-1",
            "persona": persona if persona is not None else {"slug": "brenda"},
            "messages": messages or [],
        })
        self._opening = opening
        self.opening_calls = 0
        self.cancelled = 0

    async def opening_turn(self) -> TurnResult | None:
        self.opening_calls += 1
        return self._opening

    async def cancel_inflight(self) -> None:
        self.cancelled += 1
        await super().cancel_inflight()


def _tuning(**overrides: Any) -> VoiceTuning:
    values: dict[str, Any] = dict(
        speaking_rate_wpm=140,
        silence_threshold_ms=800,
        barge_in_tolerance_ms=200,
        filler_word_frequency="low",
    )
    values.update(overrides)
    return VoiceTuning(**values)


def _hold() -> Any:
    async def _script():
        await asyncio.Event().wait()
        yield None  # pragma: no cover - keeps this an async generator

    return _script


def _user_track() -> Any:
    video = types.SimpleNamespace(track=types.SimpleNamespace(kind="video"))
    missing = types.SimpleNamespace(track=None)
    audio = types.SimpleNamespace(track=types.SimpleNamespace(kind="audio"))
    silent = types.SimpleNamespace(track_publications={"v": video})
    speaker = types.SimpleNamespace(track_publications={"m": missing, "a": audio})
    return {"silent": silent, "user": speaker}


async def _run(
    *,
    adapter: _Adapter,
    tts: _TTS,
    stt: _STT | None = None,
    captions: _Captions | None = None,
    api: _API | None = None,
    max_duration: float | None = None,
    cap_seconds: float | None = None,
    with_track: bool = False,
    shutdown: bool = True,
    tuning: VoiceTuning | None = None,
) -> tuple[_Ctx, _Captions, _API]:
    room = _Room()
    if with_track:
        room.remote_participants = _user_track()
    ctx = _Ctx(room, shutdown=shutdown)
    captions = captions or _Captions()
    api = api or _API()
    await asyncio.wait_for(
        _run_room_session(
            ctx=ctx.expose(),
            adapter=adapter,
            stt=stt or _STT(),
            tts=tts,
            captions=captions,
            api=api,
            session_id="sess-1",
            tuning=tuning or _tuning(),
            max_duration_sec=max_duration,
            cap_seconds=cap_seconds,
        ),
        timeout=5,
    )
    return ctx, captions, api


def _enable_voice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_ENABLED", "true")
    monkeypatch.setenv("LIVEKIT_URL", "ws://livekit:7880")
    monkeypatch.setenv("LIVEKIT_API_KEY", "key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")
    for name in ("PORT", "HEALTH_PORT", "HEALTH_HOST", "VOICE_INIT_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)
    _reset_settings()


# -----------------------------------------------------------------
# run_worker
# -----------------------------------------------------------------


def test_run_worker_reports_missing_sdk(monkeypatch: pytest.MonkeyPatch, caplog: Any) -> None:
    _enable_voice(monkeypatch)
    monkeypatch.setattr(
        "careersim_agent.services.persona_sync.ensure_personas_synced",
        lambda: None,
    )
    monkeypatch.setitem(sys.modules, "livekit.agents", types.ModuleType("livekit.agents"))

    with caplog.at_level(logging.ERROR):
        code = run_worker()

    assert code == 2
    assert "livekit-agents not installed" in caplog.text


def test_run_worker_starts_livekit_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_voice(monkeypatch)
    monkeypatch.setenv("PORT", "9090")
    monkeypatch.setenv("HEALTH_HOST", "127.0.0.1")
    monkeypatch.setenv("VOICE_INIT_TIMEOUT", "45")
    _reset_settings()
    monkeypatch.setattr(
        "careersim_agent.services.persona_sync.ensure_personas_synced",
        lambda: None,
    )

    seen: dict[str, Any] = {}

    class WorkerOptions:
        def __init__(self, **kwargs: Any) -> None:
            seen["options"] = kwargs

    class _Cli:
        @staticmethod
        def run_app(options: WorkerOptions) -> None:
            seen["argv"] = list(sys.argv)
            seen["app"] = options

    agents = types.ModuleType("livekit.agents")
    agents.WorkerOptions = WorkerOptions  # type: ignore[attr-defined]
    agents.cli = _Cli  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "livekit.agents", agents)

    argv = sys.argv[:]
    try:
        assert run_worker() == 0
    finally:
        sys.argv = argv

    assert seen["argv"][1:] == ["start"]
    opts = seen["options"]
    assert opts["entrypoint_fnc"] is _voice_entrypoint
    assert opts["host"] == "127.0.0.1"
    assert opts["port"] == 9090
    assert opts["initialize_process_timeout"] == 45.0


def test_run_worker_health_port_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_voice(monkeypatch)
    monkeypatch.setenv("PORT", "")
    monkeypatch.setenv("HEALTH_PORT", "7070")
    _reset_settings()
    monkeypatch.setattr(
        "careersim_agent.services.persona_sync.ensure_personas_synced",
        lambda: None,
    )
    seen: dict[str, Any] = {}

    class WorkerOptions:
        def __init__(self, **kwargs: Any) -> None:
            seen.update(kwargs)

    agents = types.ModuleType("livekit.agents")
    agents.WorkerOptions = WorkerOptions  # type: ignore[attr-defined]
    agents.cli = types.SimpleNamespace(run_app=lambda options: None)  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "livekit.agents", agents)

    argv = sys.argv[:]
    try:
        assert run_worker() == 0
    finally:
        sys.argv = argv

    assert seen["port"] == 7070
    assert seen["host"] == "0.0.0.0"
    assert seen["initialize_process_timeout"] == 30.0


def test_main_exits_with_worker_code(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("careersim_agent.voice.worker.run_worker", lambda: 4)
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 4


# -----------------------------------------------------------------
# session metadata
# -----------------------------------------------------------------


async def test_session_id_prefers_room_metadata(fast_sleep: Any) -> None:
    room = _Room()
    room.metadata = '{"session_id": "from-room"}'
    room.remote_participants = {
        "user": types.SimpleNamespace(metadata='{"session_id": "from-user"}'),
    }
    assert await _resolve_session_metadata(room) == "from-room"


async def test_session_id_falls_back_to_participant(fast_sleep: Any) -> None:
    room = _Room()
    room.metadata = "not-json"
    room.remote_participants = {
        "blank": types.SimpleNamespace(metadata="  "),
        "empty": types.SimpleNamespace(metadata='{"session_id": null}'),
        "user": types.SimpleNamespace(metadata='{"session_id": "from-user"}'),
    }
    assert await _resolve_session_metadata(room) == "from-user"


async def test_session_id_waits_then_gives_up(fast_sleep: Any) -> None:
    room = _Room()
    room.metadata = ""
    assert await _resolve_session_metadata(room) is None


async def test_session_id_appears_after_a_poll(fast_sleep: Any) -> None:
    class _Late:
        def __init__(self) -> None:
            self.hits = 0
            self.remote_participants: dict[str, Any] = {}

        @property
        def metadata(self) -> str:
            self.hits += 1
            if self.hits < 3:
                return "   "
            return '{"session_id": "late"}'

    assert await _resolve_session_metadata(_Late()) == "late"


# -----------------------------------------------------------------
# entrypoint bootstrap
# -----------------------------------------------------------------


def _patch_providers(monkeypatch: pytest.MonkeyPatch, stt: Any, tts: Any) -> None:
    monkeypatch.setattr(
        "careersim_agent.voice.providers.get_stt_provider",
        lambda persona: stt() if callable(stt) else stt,
    )
    monkeypatch.setattr(
        "careersim_agent.voice.providers.get_tts_provider",
        lambda persona: tts() if callable(tts) else tts,
    )


async def test_entrypoint_stops_when_session_is_missing(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, caplog: Any
) -> None:
    room = _Room()
    ctx = _Ctx(room)
    created: list[Any] = []
    monkeypatch.setattr(
        "careersim_agent.voice.state_bridge.APIClient.from_env",
        lambda: created.append("api"),
    )
    with caplog.at_level(logging.WARNING):
        await _voice_entrypoint(ctx)
    assert ctx.connected is True
    assert created == []
    assert "no session metadata" in caplog.text


async def test_entrypoint_closes_api_when_state_fetch_fails(
    monkeypatch: pytest.MonkeyPatch, caplog: Any
) -> None:
    room = _Room()
    room.metadata = '{"session_id": "sess-1"}'
    api = _API()
    api.state_error = RuntimeError("down")
    monkeypatch.setattr(
        "careersim_agent.voice.state_bridge.APIClient.from_env",
        lambda: api,
    )
    with caplog.at_level(logging.ERROR):
        await _voice_entrypoint(_Ctx(room))
    assert api.closed is True
    assert "failed to fetch state-for-voice" in caplog.text


async def test_entrypoint_cleans_up_failed_provider_init(
    monkeypatch: pytest.MonkeyPatch, caplog: Any
) -> None:
    room = _Room()
    room.metadata = '{"session_id": "sess-1"}'
    api = _API()
    stt = _STT()

    async def boom() -> None:
        raise RuntimeError("stt close")

    stt.aclose = boom  # type: ignore[method-assign]
    monkeypatch.setattr(
        "careersim_agent.voice.state_bridge.APIClient.from_env",
        lambda: api,
    )
    _patch_providers(
        monkeypatch,
        stt,
        lambda: (_ for _ in ()).throw(RuntimeError("tts init")),
    )
    with caplog.at_level(logging.ERROR):
        await _voice_entrypoint(_Ctx(room))
    assert api.closed is True
    assert "provider init failed" in caplog.text
    assert "stt cleanup failed" in caplog.text


async def test_entrypoint_closes_api_when_stt_init_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    room = _Room()
    room.metadata = '{"session_id": "sess-1"}'
    api = _API()
    monkeypatch.setattr(
        "careersim_agent.voice.state_bridge.APIClient.from_env",
        lambda: api,
    )

    def fail_stt(_persona: Any) -> Any:
        raise RuntimeError("no model")

    monkeypatch.setattr("careersim_agent.voice.providers.get_stt_provider", fail_stt)
    await _voice_entrypoint(_Ctx(room))
    assert api.closed is True


@pytest.mark.parametrize(
    ("budget", "remaining", "cap"),
    [
        ({"remaining_seconds": -3, "cap_seconds": 90}, 0.0, 90.0),
        ({"remaining_seconds": "later", "cap_seconds": None}, None, None),
        ({"remaining_seconds": 12.5, "cap_seconds": 30}, 12.5, 30.0),
    ],
)
async def test_entrypoint_passes_budget_into_the_room(
    monkeypatch: pytest.MonkeyPatch,
    budget: dict[str, Any],
    remaining: float | None,
    cap: float | None,
) -> None:
    room = _Room()
    room.metadata = '{"session_id": "sess-1"}'
    api = _API()
    api.budget = budget
    seen: dict[str, Any] = {}

    async def run_room(**kwargs: Any) -> None:
        seen["max"] = kwargs["max_duration_sec"]
        seen["cap"] = kwargs["cap_seconds"]

    monkeypatch.setattr("careersim_agent.voice.worker._run_room_session", run_room)
    monkeypatch.setattr(
        "careersim_agent.voice.state_bridge.APIClient.from_env",
        lambda: api,
    )
    _patch_providers(monkeypatch, _STT(), _TTS())
    await _voice_entrypoint(_Ctx(room))

    assert seen == {"max": remaining, "cap": cap}
    assert api.reported is not None
    assert api.reported[0] == "sess-1"
    assert api.reported[2] is not None
    assert api.closed is True
    payload = json.loads(room.local_participant.data[0][0])
    assert payload["role"] == "ai"
    assert payload["is_final"] is True
    assert room.local_participant.data[0][1] == "voice-captions"


async def test_entrypoint_continues_when_budget_lookup_fails(
    monkeypatch: pytest.MonkeyPatch, caplog: Any
) -> None:
    room = _Room()
    room.metadata = '{"session_id": "sess-1"}'
    api = _API()
    api.budget_error = RuntimeError("quota down")
    seen: dict[str, Any] = {}

    async def run_room(**kwargs: Any) -> None:
        seen["max"] = kwargs["max_duration_sec"]

    monkeypatch.setattr("careersim_agent.voice.worker._run_room_session", run_room)
    monkeypatch.setattr(
        "careersim_agent.voice.state_bridge.APIClient.from_env",
        lambda: api,
    )
    _patch_providers(monkeypatch, _STT(), _TTS())
    with caplog.at_level(logging.ERROR):
        await _voice_entrypoint(_Ctx(room))
    assert seen["max"] is None
    assert "failed to fetch voice budget" in caplog.text


async def test_entrypoint_swallows_finalize_and_report_failures(
    monkeypatch: pytest.MonkeyPatch, caplog: Any
) -> None:
    room = _Room()
    room.metadata = '{"session_id": "sess-1"}'
    api = _API()
    api.report_error = RuntimeError("end failed")
    monkeypatch.setattr("careersim_agent.voice.worker._run_room_session", _async_ok)
    monkeypatch.setattr(
        "careersim_agent.voice.state_bridge.APIClient.from_env",
        lambda: api,
    )
    monkeypatch.setattr(
        LangGraphAdapter,
        "finalize_voice_analysis",
        lambda self: (_ for _ in ()).throw(RuntimeError("finalize")),
    )
    stt, tts = _STT(), _TTS()
    _patch_providers(monkeypatch, stt, tts)
    with caplog.at_level(logging.ERROR):
        await _voice_entrypoint(_Ctx(room))
    assert "finalize_voice_analysis failed" in caplog.text
    assert "voice/end report failed" in caplog.text
    assert stt.closed is True
    assert tts.closed is True
    assert api.closed is True


async def _async_ok(**_kwargs: Any) -> None:
    return None


# -----------------------------------------------------------------
# room session
# -----------------------------------------------------------------


async def test_opening_burst_stops_after_an_interruption(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any
) -> None:
    _install_livekit(monkeypatch)
    managers: list[TurnManager] = []
    original = TurnManager.__init__

    def capture(self: TurnManager, *args: Any, **kwargs: Any) -> None:
        managers.append(self)
        original(self, *args, **kwargs)

    monkeypatch.setattr(TurnManager, "__init__", capture)
    tts = _TTS()

    async def synthesize(text: str):
        managers[0]._speak_state["turn_interrupted"] = True
        yield types.SimpleNamespace(audio=b"\x01\x00" * 2)

    tts.synthesize = synthesize  # type: ignore[method-assign]
    adapter = _Adapter(opening=TurnResult(
        text="Hello there",
        new_state={},
        burst_messages=["Hello", "there"],
    ))
    _ctx, captions, _api = await _run(adapter=adapter, tts=tts)
    assert [c.text for c in captions.published] == ["Hello"]


async def test_opening_burst_stops_before_the_next_bubble(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any
) -> None:
    _install_livekit(monkeypatch)
    managers: list[TurnManager] = []
    original = TurnManager.__init__

    def capture(self: TurnManager, *args: Any, **kwargs: Any) -> None:
        managers.append(self)
        original(self, *args, **kwargs)

    monkeypatch.setattr(TurnManager, "__init__", capture)

    class _Bursts(list[str]):
        def __iter__(self) -> Any:
            yield "Hello"
            managers[0]._speak_state["turn_interrupted"] = True
            yield "there"

    adapter = _Adapter(opening=TurnResult(
        text="Hello there",
        new_state={},
        burst_messages=_Bursts(["Hello", "there"]),
    ))
    _ctx, captions, _api = await _run(adapter=adapter, tts=_TTS())
    assert [c.text for c in captions.published] == ["Hello"]


async def test_room_speaks_opening_then_ends_without_a_mic(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None, caplog: Any
) -> None:
    _install_livekit(monkeypatch)
    adapter = _Adapter(opening=TurnResult(
        text="Hello there",
        new_state={},
        burst_messages=["Hello", "  ", "there"],
    ))
    tts = _TTS(rate=22050)
    with caplog.at_level(logging.WARNING):
        ctx, captions, _api = await _run(adapter=adapter, tts=tts)
    assert [c.text for c in captions.published] == ["Hello", "there"]
    assert captions.controls[-1] == {"type": "turn_committed"}
    assert [t.transcript for t in adapter._voice_turns] == ["Hello", "there"]
    assert tts.texts == ["Hello", "there"]
    assert ctx.room.local_participant.tracks
    assert "no user audio track" in caplog.text
    await ctx.callbacks[0]("room closed")


async def test_room_skips_opening_when_the_transcript_exists(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None, caplog: Any
) -> None:
    _install_livekit(monkeypatch)
    adapter = _Adapter(
        messages=[{"role": "human", "content": "already chatting"}],
        opening=TurnResult(text="should not speak", new_state={}),
    )
    with caplog.at_level(logging.INFO):
        _ctx, captions, _api = await _run(adapter=adapter, tts=_TTS(), shutdown=False)
    assert adapter.opening_calls == 0
    assert captions.published == []
    assert "skipping opening turn" in caplog.text


async def test_room_ignores_an_empty_opening(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None
) -> None:
    _install_livekit(monkeypatch)
    adapter = _Adapter(opening=TurnResult(text="", new_state={}, burst_messages=["x"]))
    _ctx, captions, _api = await _run(adapter=adapter, tts=_TTS())
    assert adapter.opening_calls == 1
    assert captions.published == []


async def test_playback_failure_notifies_the_client(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None, caplog: Any
) -> None:
    _install_livekit(monkeypatch)
    adapter = _Adapter(opening=TurnResult(text="Hello", new_state={}))
    captions = _Captions()
    captions.fail = True
    with caplog.at_level(logging.ERROR):
        await _run(
            adapter=adapter,
            tts=_TTS(fail=True),
            captions=captions,
        )
    assert captions.controls[0]["type"] == "tts_error"
    assert "TTS playback failed" in caplog.text
    assert adapter._voice_turns[0].transcript == "Hello"


async def test_barge_in_cancels_playback(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None
) -> None:
    kit = _install_livekit(monkeypatch)
    kit.clear_fails = True
    kit.audio_fail_close = True
    kit.vad_fail_close = True
    kit.source_fail_close = True
    tts = _TTS(rate=22050, block=asyncio.Event())
    stt = _STT([[STTResult(text="hello there", is_final=True, confidence=0.9)]])
    frames = [
        types.SimpleNamespace(data=b"\x01\x02\x03\x04", samples_per_channel=2, sample_rate=16000),
        types.SimpleNamespace(data=b"\x01\x02", samples_per_channel=1, sample_rate=0),
    ]

    def vad() -> Any:
        async def script():
            yield types.SimpleNamespace(type="end", frames=frames)
            await tts.started.wait()
            yield types.SimpleNamespace(type="start", frames=[])
            await asyncio.sleep(0)
            room.handlers["participant_disconnected"]()
            room.remote_participants.clear()
            room.handlers["participant_disconnected"]()
            room.handlers["disconnected"]()

        return script()

    room = _Room()
    room.remote_participants = _user_track()
    kit.audio_script = _hold()
    kit.vad_script = vad
    adapter = _Adapter()
    captions = _Captions()
    ctx = _Ctx(room)
    await asyncio.wait_for(
        _run_room_session(
            ctx=ctx,
            adapter=adapter,
            stt=stt,
            tts=tts,
            captions=captions,
            api=_API(),
            session_id="sess-1",
            tuning=_tuning(barge_in_tolerance_ms=10),
            max_duration_sec=None,
        ),
        timeout=5,
    )
    assert adapter.cancelled >= 1
    assert any(turn.was_interrupted for turn in adapter._voice_turns)
    assert kit.vad_kwargs is not None
    assert kit.vad_kwargs["min_speech_duration"] == 0.05
    assert kit.pushed_frames == []
    assert kit.resamplers
    assert kit.sources[0].frames


async def test_barge_in_with_no_playback_task_still_clears_audio(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None
) -> None:
    kit = _install_livekit(monkeypatch)
    kit.clear_fails = True
    managers: list[TurnManager] = []
    wrapped = TurnManager.__init__

    def capture(self: TurnManager, *args: Any, **kwargs: Any) -> None:
        managers.append(self)
        wrapped(self, *args, **kwargs)

    monkeypatch.setattr(TurnManager, "__init__", capture)
    release = asyncio.Event()
    tts = _TTS(block=release)
    frames = [types.SimpleNamespace(data=b"\x00\x01", samples_per_channel=1, sample_rate=16000)]

    def vad() -> Any:
        async def script():
            yield types.SimpleNamespace(type="end", frames=frames)
            await tts.started.wait()
            # Speak is in flight, but the stored task handle is already gone.
            managers[0]._speak_state["task"] = None
            yield types.SimpleNamespace(type="start", frames=[])
            release.set()
            await asyncio.sleep(0)
            room.handlers["disconnected"]()

        return script()

    room = _Room()
    room.remote_participants = _user_track()
    kit.audio_script = _hold()
    kit.vad_script = vad
    adapter = _Adapter()
    await asyncio.wait_for(
        _run_room_session(
            ctx=_Ctx(room),
            adapter=adapter,
            stt=_STT([[STTResult(text="hello", is_final=True)]]),
            tts=tts,
            captions=_Captions(),
            api=_API(),
            session_id="sess-1",
            tuning=_tuning(),
        ),
        timeout=5,
    )
    assert adapter.cancelled >= 1
    assert managers[0]._speak_state["task"] is None


async def test_budget_speaks_a_heads_up_when_idle(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None
) -> None:
    kit = _install_livekit(monkeypatch)
    kit.audio_script = _hold()
    kit.vad_script = _hold()
    tts = _TTS(rate=48000)
    _ctx, captions, _api = await _run(
        adapter=_Adapter(),
        tts=tts,
        with_track=True,
        max_duration=0,
        cap_seconds=None,
    )
    assert any(text.startswith("Heads up") for text in tts.texts)
    assert captions.controls[0]["type"] == "quota_warning"
    assert captions.controls[0]["cap_seconds"] is None
    assert captions.controls[1] == {"type": "quota_exhausted", "cap_seconds": None}
    assert kit.resamplers == []
    assert kit.sources[0].frames


async def test_budget_skips_the_heads_up_while_speaking(
    monkeypatch: pytest.MonkeyPatch, fast_turns: None
) -> None:
    kit = _install_livekit(monkeypatch)
    release = asyncio.Event()
    tts = _TTS(block=release)
    captions = _Captions()
    captions.release = release
    real = asyncio.sleep

    async def sleep(delay: float = 0) -> None:
        if delay >= 50 and not tts.started.is_set():
            await tts.started.wait()
        await real(0)

    monkeypatch.setattr(asyncio, "sleep", sleep)
    frames = [types.SimpleNamespace(data=b"\x00\x01", samples_per_channel=1, sample_rate=16000)]

    def vad() -> Any:
        async def script():
            yield types.SimpleNamespace(type="end", frames=frames)
            await asyncio.Event().wait()
            yield None

        return script()

    kit.audio_script = _hold()
    kit.vad_script = vad
    _ctx, _captions, api = await _run(
        adapter=_Adapter(),
        tts=tts,
        stt=_STT([
            [
                STTResult(text="hel", is_final=False, confidence=0.2),
                STTResult(text="  ", is_final=True),
                STTResult(text="hello", is_final=True, confidence=0.8),
            ]
        ]),
        captions=captions,
        with_track=True,
        max_duration=120,
        cap_seconds=600,
        tuning=_tuning(barge_in_tolerance_ms=400),
    )
    assert not any(text.startswith("Heads up") for text in tts.texts)
    assert "Sure." in tts.texts
    assert api.streams == [["hello"]]
    assert captions.controls[0]["type"] == "quota_warning"
    assert captions.controls[0]["remaining_seconds"] == 60
    assert kit.vad_kwargs is not None
    assert kit.vad_kwargs["min_speech_duration"] == 0.4


async def test_audio_and_vad_failures_are_logged(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None, caplog: Any
) -> None:
    kit = _install_livekit(monkeypatch)

    def audio() -> Any:
        async def script():
            yield types.SimpleNamespace(frame="pcm")
            await asyncio.sleep(0)
            raise RuntimeError("forward boom")

        return script()

    frames = [types.SimpleNamespace(data=b"\x00\x01", samples_per_channel=1, sample_rate=16000)]

    def vad() -> Any:
        async def script():
            yield types.SimpleNamespace(type="start", frames=[])
            yield types.SimpleNamespace(type="end", frames=[])
            yield types.SimpleNamespace(type="end", frames=frames)
            await asyncio.sleep(0)
            raise RuntimeError("vad boom")

        return script()

    kit.audio_script = audio
    kit.vad_script = vad
    with caplog.at_level(logging.ERROR):
        await _run(
            adapter=_Adapter(),
            tts=_TTS(),
            stt=_STT([RuntimeError("stt down")]),
            with_track=True,
        )
    assert "audio forward loop crashed" in caplog.text
    assert "VAD consume loop crashed" in caplog.text
    assert "STT failed" in caplog.text
    assert kit.pushed_frames == ["pcm"]


async def test_stt_worker_timeout_cancels_a_hung_transcribe(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None
) -> None:
    kit = _install_livekit(monkeypatch)
    real_wait = asyncio.wait_for

    async def wait_for(awaitable: Any, timeout: float | None = None) -> Any:
        if timeout == 10.0:
            raise asyncio.TimeoutError
        return await real_wait(awaitable, timeout)

    monkeypatch.setattr(asyncio, "wait_for", wait_for)
    frames = [types.SimpleNamespace(data=b"\x00\x01", samples_per_channel=1, sample_rate=16000)]

    def vad() -> Any:
        async def script():
            yield types.SimpleNamespace(type="end", frames=frames)
            await asyncio.sleep(0)
            room.handlers["disconnected"]()

        return script()

    room = _Room()
    room.remote_participants = _user_track()
    kit.audio_script = _hold()
    kit.vad_script = vad
    await asyncio.wait_for(
        _run_room_session(
            ctx=_Ctx(room),
            adapter=_Adapter(),
            stt=_STT(hang=True),
            tts=_TTS(),
            captions=_Captions(),
            api=_API(),
            session_id="sess-1",
            tuning=_tuning(),
        ),
        timeout=5,
    )


async def test_budget_watchdog_crash_still_ends_the_room(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None, caplog: Any
) -> None:
    kit = _install_livekit(monkeypatch)
    kit.audio_script = _hold()
    kit.vad_script = _hold()
    captions = _Captions()
    captions.fail = True
    with caplog.at_level(logging.ERROR):
        await _run(
            adapter=_Adapter(persona={}),
            tts=_TTS(),
            captions=captions,
            with_track=True,
            max_duration=0,
            cap_seconds=300,
        )
    assert "budget watchdog crashed" in caplog.text


async def test_false_start_rearms_and_a_finished_stt_worker_is_not_waited_on(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None, caplog: Any
) -> None:
    kit = _install_livekit(monkeypatch)
    entered = asyncio.Event()
    gate = asyncio.Event()

    class _Gated(_API):
        async def stream_user_message(self, session_id: str, texts: list[str], expected_message_count: int | None = None):
            self.streams.append(list(texts))
            entered.set()
            await gate.wait()
            yield {"type": "message", "content": "Sure."}
            yield {"type": "done"}

    class _Raising(_Adapter):
        def record_voice_turn(self, turn: Any) -> None:
            if turn.role == "human" and turn.transcript == "boom":
                raise RuntimeError("record failed")
            super().record_voice_turn(turn)

    frames = [types.SimpleNamespace(data=b"\x00\x01", samples_per_channel=1, sample_rate=16000)]
    stt = _STT([
        [STTResult(text="  ", is_final=True)],
        [STTResult(text="hello", is_final=True)],
        [STTResult(text="  ", is_final=True)],
        [STTResult(text="boom", is_final=True)],
        asyncio.CancelledError(),
    ])

    async def transcribe(frames: Any):
        async for _chunk in frames:
            pass
        item = stt.script.pop(0)
        if isinstance(item, type) and issubclass(item, BaseException):
            raise item()
        if isinstance(item, BaseException):
            raise item
        for result in item:
            yield result

    stt.transcribe = transcribe  # type: ignore[method-assign]

    def vad() -> Any:
        async def script():
            yield types.SimpleNamespace(type="other", frames=[])
            yield types.SimpleNamespace(type="end", frames=frames)
            yield types.SimpleNamespace(type="end", frames=frames)
            await entered.wait()
            yield types.SimpleNamespace(type="end", frames=frames)
            await asyncio.sleep(0)
            gate.set()
            yield types.SimpleNamespace(type="end", frames=frames)
            yield types.SimpleNamespace(type="end", frames=frames)
            await asyncio.sleep(0)
            room.handlers["disconnected"]()

        return script()

    room = _Room()
    room.remote_participants = _user_track()
    kit.audio_script = _hold()
    kit.vad_script = vad
    with caplog.at_level(logging.ERROR):
        await asyncio.wait_for(
            _run_room_session(
                ctx=_Ctx(room),
                adapter=_Raising(),
                stt=stt,
                tts=_TTS(),
                captions=_Captions(),
                api=_Gated(),
                session_id="sess-1",
                tuning=_tuning(),
            ),
            timeout=5,
        )
    assert "utterance handling failed" in caplog.text


async def test_an_empty_mic_stream_ends_the_room(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None
) -> None:
    kit = _install_livekit(monkeypatch)

    def audio() -> Any:
        async def script():
            return
            yield None

        return script()

    kit.audio_script = audio
    kit.vad_script = _hold()
    await _run(adapter=_Adapter(), tts=_TTS(), with_track=True)


async def test_disconnect_cancels_a_waiting_watchdog(
    monkeypatch: pytest.MonkeyPatch, fast_sleep: Any, fast_turns: None
) -> None:
    kit = _install_livekit(monkeypatch)

    def audio() -> Any:
        async def script():
            await asyncio.sleep(0)
            room.handlers["disconnected"]()
            await asyncio.Event().wait()
            yield None

        return script()

    room = _Room()
    room.remote_participants = _user_track()
    kit.audio_script = audio
    kit.vad_script = _hold()
    await asyncio.wait_for(
        _run_room_session(
            ctx=_Ctx(room),
            adapter=_Adapter(),
            stt=_STT(),
            tts=_TTS(),
            captions=_Captions(),
            api=_API(),
            session_id="sess-1",
            tuning=_tuning(),
            max_duration_sec=10_000,
            cap_seconds=10_000,
        ),
        timeout=5,
    )
