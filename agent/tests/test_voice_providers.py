"""Tests for the voice provider factory + Protocol conformance.

Heavy SDKs (faster-whisper, piper, livekit, deepgram) are NOT
required by this suite — every provider impl uses lazy imports, so
we can construct the wrappers and verify their factory wiring + base
metadata without those wheels installed in the test environment.
"""

from __future__ import annotations

import base64
import json
import sys
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from careersim_agent.voice.providers import (
    STTProvider,
    TTSProvider,
    UnsupportedProviderError,
    get_stt_provider,
    get_tts_provider,
)
from careersim_agent.voice.providers.deepgram import DeepgramSTT
from careersim_agent.voice.providers.elevenlabs import ElevenLabsTTS
from careersim_agent.voice.providers.openai_tts import OpenAITTS
from careersim_agent.voice.providers.piper_local import PiperLocalTTS
from careersim_agent.voice.providers.whisper_local import WhisperLocalSTT
from careersim_agent.voice.providers.whisper_openai import (
    WhisperOpenAISTT,
    _openrouter_limiter,
)


def _settings(**overrides: Any) -> SimpleNamespace:
    """Build a SimpleNamespace mimicking the bits of Settings the
    factory reads. Lets each test pin one knob without touching env.
    """
    base = dict(
        voice_stt_provider="whisper_local",
        voice_tts_provider="piper_local",
        voice_whisper_model="base.en",
        voice_whisper_device="cpu",
        voice_whisper_compute_type="int8",
        voice_whisper_openai_model="whisper-1",
        voice_openai_tts_model="openai/gpt-4o-mini-tts",
        voice_piper_model_dir="/tmp/piper",
        voice_piper_default_voice="en_US-libritts_r-medium",
        deepgram_api_key="",
        elevenlabs_api_key="",
        openai_api_key="sk-fake",
        openai_base_url=None,
        openai_default_headers={},
    )
    base.update(overrides)
    return SimpleNamespace(**base)


PERSONA = {
    "slug": "vikram-shah-pipeline-recruiter",
    "voice": {
        "providers": {
            "piper_local": {"voiceModel": "en_US-ryan-high"},
            "openai_tts": {"voice": "echo", "speed": 1.05},
            "elevenlabs": {"voiceId": "vid-123"},
        },
    },
}


# -----------------------------------------------------------------
# STT factory
# -----------------------------------------------------------------

class TestSTTFactory:
    def test_default_is_whisper_local(self) -> None:
        provider = get_stt_provider(PERSONA, settings_override=_settings())
        assert isinstance(provider, WhisperLocalSTT)
        assert provider.name == "whisper_local"
        assert provider.input_sample_rate() == 16000

    def test_whisper_openai(self) -> None:
        s = _settings(voice_stt_provider="whisper_openai")
        provider = get_stt_provider(PERSONA, settings_override=s)
        assert isinstance(provider, WhisperOpenAISTT)
        assert provider._model == "whisper-1"

    def test_whisper_openai_model_configurable(self) -> None:
        s = _settings(
            voice_stt_provider="whisper_openai",
            voice_whisper_openai_model="openai/whisper-large-v3",
        )
        provider = get_stt_provider(PERSONA, settings_override=s)
        assert isinstance(provider, WhisperOpenAISTT)
        assert provider._model == "openai/whisper-large-v3"

    def test_whisper_openai_with_openrouter_base_url(self) -> None:
        # whisper_openai stays the same provider class; it just adapts its
        # request shape internally when the base URL is OpenRouter.
        s = _settings(
            voice_stt_provider="whisper_openai",
            openai_base_url="https://openrouter.ai/api/v1",
            voice_whisper_openai_model="openai/whisper-large-v3",
        )
        provider = get_stt_provider(PERSONA, settings_override=s)
        assert isinstance(provider, WhisperOpenAISTT)
        assert provider._model == "openai/whisper-large-v3"
        assert provider._base_url == "https://openrouter.ai/api/v1"

    def test_deepgram_requires_key(self) -> None:
        s = _settings(voice_stt_provider="deepgram")
        with pytest.raises(UnsupportedProviderError, match="DEEPGRAM_API_KEY"):
            get_stt_provider(PERSONA, settings_override=s)

    def test_deepgram_with_key(self) -> None:
        s = _settings(voice_stt_provider="deepgram", deepgram_api_key="dg-fake")
        provider = get_stt_provider(PERSONA, settings_override=s)
        assert isinstance(provider, DeepgramSTT)

    def test_unknown_provider_raises(self) -> None:
        s = _settings(voice_stt_provider="bogus")
        with pytest.raises(UnsupportedProviderError, match="unknown STT provider"):
            get_stt_provider(PERSONA, settings_override=s)


# -----------------------------------------------------------------
# TTS factory
# -----------------------------------------------------------------

class TestTTSFactory:
    def test_default_is_piper_local(self) -> None:
        provider = get_tts_provider(PERSONA, settings_override=_settings())
        assert isinstance(provider, PiperLocalTTS)
        assert provider.name == "piper_local"
        # `output_sample_rate()` reads the rate off the loaded model, so it
        # needs both piper-tts installed *and* the voice file on disk —
        # neither is guaranteed in this lightweight suite (see module
        # docstring). Only assert it when the runtime is actually present.
        piper = pytest.importorskip("piper", reason="piper-tts not installed")
        del piper
        try:
            assert provider.output_sample_rate() == 22050
        except FileNotFoundError:
            pytest.skip("piper voice model not present in test environment")

    def test_openai_tts(self) -> None:
        s = _settings(voice_tts_provider="openai_tts")
        provider = get_tts_provider(PERSONA, settings_override=s)
        assert isinstance(provider, OpenAITTS)
        assert provider.output_sample_rate() == 24000

    def test_openai_tts_with_openrouter_base_url_uses_slug(self) -> None:
        # Same provider class; it just swaps in the OpenRouter model slug.
        s = _settings(
            voice_tts_provider="openai_tts",
            openai_base_url="https://openrouter.ai/api/v1",
        )
        provider = get_tts_provider(PERSONA, settings_override=s)
        assert isinstance(provider, OpenAITTS)
        assert provider._model == "openai/gpt-4o-mini-tts"
        # persona's openai_tts voice carries over unchanged
        assert provider._persona_voice == "echo"

    def test_openai_tts_with_openai_base_url_uses_bare_model(self) -> None:
        s = _settings(
            voice_tts_provider="openai_tts",
            openai_base_url="https://api.openai.com/v1",
        )
        provider = get_tts_provider(PERSONA, settings_override=s)
        assert isinstance(provider, OpenAITTS)
        assert provider._model == "gpt-4o-mini-tts"

    def test_elevenlabs_requires_key(self) -> None:
        s = _settings(voice_tts_provider="elevenlabs")
        with pytest.raises(UnsupportedProviderError, match="ELEVENLABS_API_KEY"):
            get_tts_provider(PERSONA, settings_override=s)

    def test_elevenlabs_requires_voice_id(self) -> None:
        s = _settings(voice_tts_provider="elevenlabs", elevenlabs_api_key="el-fake")
        persona_no_voice_id = {
            "voice": {"providers": {"elevenlabs": {}}}
        }
        with pytest.raises(UnsupportedProviderError, match="voiceId"):
            get_tts_provider(persona_no_voice_id, settings_override=s)

    def test_elevenlabs_happy_path(self) -> None:
        s = _settings(voice_tts_provider="elevenlabs", elevenlabs_api_key="el-fake")
        provider = get_tts_provider(PERSONA, settings_override=s)
        assert isinstance(provider, ElevenLabsTTS)

    def test_persona_override_wins(self) -> None:
        # Global default piper_local; persona pins elevenlabs (with valid
        # config + key) -> factory should mint an ElevenLabsTTS.
        persona = dict(PERSONA)
        persona["voice"] = dict(PERSONA["voice"])
        persona["voice"]["providerOverride"] = "elevenlabs"
        s = _settings(elevenlabs_api_key="el-fake")
        provider = get_tts_provider(persona, settings_override=s)
        assert isinstance(provider, ElevenLabsTTS)

    def test_unknown_provider_raises(self) -> None:
        s = _settings(voice_tts_provider="bogus")
        with pytest.raises(UnsupportedProviderError, match="unknown TTS provider"):
            get_tts_provider(PERSONA, settings_override=s)


# -----------------------------------------------------------------
# Protocol conformance — sanity check that every concrete provider
# is `runtime_checkable`-compatible with the Protocols. Catches
# accidental method renames before they reach the worker.
# -----------------------------------------------------------------

# -----------------------------------------------------------------
# OpenRouter request-shape — the whole reason whisper_openai branches:
# OpenRouter rejects the SDK's multipart upload, so against an
# OpenRouter base URL the provider must POST JSON + base64 instead.
# -----------------------------------------------------------------

class _FakeResponse:
    def __init__(
        self,
        payload: dict[str, Any],
        *,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://openrouter.ai/api/v1/audio/transcriptions")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError(
                f"{self.status_code}",
                request=request,
                response=response,
            )

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeHttpClient:
    """Records POSTs; can return a sequence of canned responses."""

    def __init__(
        self,
        payload: dict[str, Any] | None = None,
        *,
        responses: list[_FakeResponse] | None = None,
    ) -> None:
        if responses is not None:
            self._responses = list(responses)
        else:
            self._responses = [_FakeResponse(payload or {})]
        self.last_url: Any = None
        self.last_json: Any = None
        self.post_count = 0

    async def post(self, url: str, *, json: dict[str, Any]) -> _FakeResponse:
        self.last_url = url
        self.last_json = json
        self.post_count += 1
        if not self._responses:
            raise AssertionError("unexpected extra POST")
        return self._responses.pop(0)


class TestOpenRouterRequestShape:
    def setup_method(self) -> None:
        # Process-wide limiter must not leak state between tests.
        _openrouter_limiter.reset()

    async def test_openrouter_stt_posts_json_base64(self) -> None:
        provider = WhisperOpenAISTT(
            api_key="sk-or-fake",
            base_url="https://openrouter.ai/api/v1",
            model="openai/whisper-1",
        )
        fake = _FakeHttpClient({"text": "hello world"})
        provider._ensure_http = lambda: fake  # type: ignore[method-assign]

        async def _frames():
            yield b"\x00\x01" * 800  # 1600 bytes of fake PCM

        results = [r async for r in provider.transcribe(_frames(), language="en")]

        assert len(results) == 1
        assert results[0].text == "hello world"
        assert results[0].is_final is True
        # Wire shape: JSON body with base64 audio under input_audio, NOT a
        # multipart file upload.
        assert fake.last_url == "/audio/transcriptions"
        assert fake.last_json["model"] == "openai/whisper-1"
        assert fake.last_json["input_audio"]["format"] == "wav"
        assert isinstance(fake.last_json["input_audio"]["data"], str)
        assert fake.last_json["language"] == "en"

    async def test_openrouter_stt_retries_429_then_succeeds(self) -> None:
        provider = WhisperOpenAISTT(
            api_key="sk-or-fake",
            base_url="https://openrouter.ai/api/v1",
            model="openai/whisper-1",
        )
        fake = _FakeHttpClient(
            responses=[
                _FakeResponse({}, status_code=429, headers={"Retry-After": "0"}),
                _FakeResponse({"text": "recovered"}),
            ]
        )
        provider._ensure_http = lambda: fake  # type: ignore[method-assign]

        async def _frames():
            yield b"\x00\x01" * 800

        results = [r async for r in provider.transcribe(_frames(), language="en")]

        assert fake.post_count == 2
        assert len(results) == 1
        assert results[0].text == "recovered"
        assert _openrouter_limiter.consecutive_429s == 0

    async def test_openrouter_stt_exhausts_429_retries(self) -> None:
        provider = WhisperOpenAISTT(
            api_key="sk-or-fake",
            base_url="https://openrouter.ai/api/v1",
            model="openai/whisper-1",
        )
        fake = _FakeHttpClient(
            responses=[
                _FakeResponse({}, status_code=429, headers={"Retry-After": "0"}),
                _FakeResponse({}, status_code=429, headers={"Retry-After": "0"}),
                _FakeResponse({}, status_code=429, headers={"Retry-After": "0"}),
            ]
        )
        provider._ensure_http = lambda: fake  # type: ignore[method-assign]

        async def _frames():
            yield b"\x00\x01" * 800

        with pytest.raises(RuntimeError, match="OpenRouter STT failed"):
            [r async for r in provider.transcribe(_frames(), language="en")]

        assert fake.post_count == 3
        assert _openrouter_limiter.consecutive_429s == 1

    async def test_openrouter_stt_circuit_breaker_pauses_requests(self) -> None:
        provider = WhisperOpenAISTT(
            api_key="sk-or-fake",
            base_url="https://openrouter.ai/api/v1",
            model="openai/whisper-1",
        )

        async def _frames():
            yield b"\x00\x01" * 800

        # Trip the breaker with three consecutive exhausted 429 utterances.
        for _ in range(3):
            fake = _FakeHttpClient(
                responses=[
                    _FakeResponse({}, status_code=429, headers={"Retry-After": "0"}),
                    _FakeResponse({}, status_code=429, headers={"Retry-After": "0"}),
                    _FakeResponse({}, status_code=429, headers={"Retry-After": "0"}),
                ]
            )
            provider._ensure_http = lambda f=fake: f  # type: ignore[method-assign]
            with pytest.raises(RuntimeError, match="OpenRouter STT failed"):
                [r async for r in provider.transcribe(_frames(), language="en")]

        assert _openrouter_limiter.circuit_remaining() > 0

        # Next call must fail fast without another POST.
        blocked = _FakeHttpClient({"text": "should not run"})
        provider._ensure_http = lambda: blocked  # type: ignore[method-assign]
        with pytest.raises(RuntimeError, match="circuit open"):
            [r async for r in provider.transcribe(_frames(), language="en")]
        assert blocked.post_count == 0


# -----------------------------------------------------------------
# ElevenLabs websockets header kwarg — websockets >= 14 renamed
# `extra_headers` to `additional_headers`; passing the old name to the
# new client 500s deep in create_connection. The provider must use the
# new name (with a legacy fallback).
# -----------------------------------------------------------------

class _FakeElevenWS:
    def __init__(self, frames: list[str]) -> None:
        self._frames = frames
        self.sent: list[str] = []
        self.closed = False

    async def send(self, msg: str) -> None:
        self.sent.append(msg)

    async def close(self) -> None:
        self.closed = True

    def __aiter__(self):
        return self._aiter()

    async def _aiter(self):
        for f in self._frames:
            yield f


_DEFAULT_ELEVEN_FRAMES = [
    json.dumps({"audio": base64.b64encode(b"\x01\x02\x03\x04").decode()}),
    json.dumps({"isFinal": True}),
]


class _FakeWebsocketsModule:
    """Stand-in for the `websockets` package injected via sys.modules."""

    def __init__(
        self,
        *,
        accepts: str = "additional_headers",
        frames: list[str] | None = None,
    ) -> None:
        # `accepts` is the only header kwarg this fake tolerates;
        # the other raises TypeError like the real version mismatch.
        self._accepts = accepts
        self._frames = _DEFAULT_ELEVEN_FRAMES if frames is None else frames
        self.connect_kwargs: list[dict[str, Any]] = []
        self.last_ws: _FakeElevenWS | None = None

    async def connect(self, url: str, **kwargs: Any) -> _FakeElevenWS:
        self.connect_kwargs.append(kwargs)
        if self._accepts not in kwargs:
            raise TypeError(
                f"unexpected keyword argument "
                f"{next(iter(kwargs)) if kwargs else 'headers'!r}"
            )
        self.last_ws = _FakeElevenWS(list(self._frames))
        return self.last_ws


class TestElevenLabsWebsocketHeaders:
    async def test_uses_additional_headers(self, monkeypatch: Any) -> None:
        fake = _FakeWebsocketsModule(accepts="additional_headers")
        monkeypatch.setitem(sys.modules, "websockets", fake)

        provider = ElevenLabsTTS(
            api_key="el-fake", persona_config={"voiceId": "vid-123"}
        )
        chunks = [c async for c in provider.synthesize("hello")]

        assert len(chunks) == 1
        assert chunks[0].audio == b"\x01\x02\x03\x04"
        assert chunks[0].is_final is True
        # New API kwarg used, carrying the auth header, and ws closed.
        assert fake.connect_kwargs[-1] == {"additional_headers": {"xi-api-key": "el-fake"}}
        assert fake.last_ws is not None and fake.last_ws.closed is True

    async def test_falls_back_to_extra_headers(self, monkeypatch: Any) -> None:
        # Simulate an older websockets that only knows `extra_headers`.
        fake = _FakeWebsocketsModule(accepts="extra_headers")
        monkeypatch.setitem(sys.modules, "websockets", fake)

        provider = ElevenLabsTTS(
            api_key="el-fake", persona_config={"voiceId": "vid-123"}
        )
        chunks = [c async for c in provider.synthesize("hello")]

        assert len(chunks) == 1
        # Tried the new name first, then fell back to the legacy one.
        assert "additional_headers" in fake.connect_kwargs[0]
        assert fake.connect_kwargs[-1] == {"extra_headers": {"xi-api-key": "el-fake"}}


# -----------------------------------------------------------------
# ElevenLabs failure surfacing — rejections used to be swallowed
# (error frames ignored, zero-audio streams returned "cleanly"),
# leaving the persona silently mute with nothing in the logs.
# -----------------------------------------------------------------

class TestElevenLabsFailureSurfacing:
    async def test_error_frame_raises(self, monkeypatch: Any) -> None:
        # In-band rejection: invalid voice ID / quota / concurrency cap.
        fake = _FakeWebsocketsModule(frames=[
            json.dumps({
                "error": "voice_not_found",
                "message": "A voice with voice_id vid-123 was not found.",
            }),
        ])
        monkeypatch.setitem(sys.modules, "websockets", fake)

        provider = ElevenLabsTTS(
            api_key="el-fake", persona_config={"voiceId": "vid-123"}
        )
        with pytest.raises(RuntimeError, match="voice_not_found"):
            async for _ in provider.synthesize("hello"):
                pass
        # Socket still closed despite the raise.
        assert fake.last_ws is not None and fake.last_ws.closed is True

    async def test_zero_audio_stream_raises(self, monkeypatch: Any) -> None:
        # Stream ends without audio and without an explicit error frame
        # (abnormal close, silent rejection) — must not return quietly.
        fake = _FakeWebsocketsModule(frames=[json.dumps({"isFinal": True})])
        monkeypatch.setitem(sys.modules, "websockets", fake)

        provider = ElevenLabsTTS(
            api_key="el-fake", persona_config={"voiceId": "vid-123"}
        )
        with pytest.raises(RuntimeError, match="no audio"):
            async for _ in provider.synthesize("hello"):
                pass
        assert fake.last_ws is not None and fake.last_ws.closed is True

    async def test_connect_failure_raises_runtime_error(
        self, monkeypatch: Any
    ) -> None:
        class _RefusingWebsockets:
            async def connect(self, url: str, **kwargs: Any) -> Any:
                raise OSError("connection refused")

        monkeypatch.setitem(sys.modules, "websockets", _RefusingWebsockets())

        provider = ElevenLabsTTS(
            api_key="el-fake", persona_config={"voiceId": "vid-123"}
        )
        with pytest.raises(RuntimeError, match="connect failed"):
            async for _ in provider.synthesize("hello"):
                pass


# -----------------------------------------------------------------
# Piper failure surfacing — the producer thread's exception used to be
# stranded on a never-awaited executor future, so a broken synthesis
# ended the stream with zero chunks and zero log lines.
# -----------------------------------------------------------------

class TestPiperFailureSurfacing:
    async def test_producer_exception_propagates(self) -> None:
        class _BrokenVoice:
            def synthesize(self, text: str) -> Any:
                raise ValueError("model file is corrupt")

        provider = PiperLocalTTS(model_dir="/tmp", default_voice="x")
        provider._voice = _BrokenVoice()  # skip _ensure_voice / piper import

        with pytest.raises(RuntimeError, match="model file is corrupt"):
            async for _ in provider.synthesize("hello"):
                pass

    async def test_mid_stream_exception_propagates_after_chunks(self) -> None:
        class _FlakyChunk:
            audio_int16_bytes = b"\x00\x01\x02\x03"

        class _FlakyVoice:
            def synthesize(self, text: str) -> Any:
                yield _FlakyChunk()
                yield _FlakyChunk()
                raise ValueError("onnxruntime blew up")

        provider = PiperLocalTTS(model_dir="/tmp", default_voice="x")
        provider._voice = _FlakyVoice()

        received: list[bytes] = []
        with pytest.raises(RuntimeError, match="onnxruntime blew up"):
            async for chunk in provider.synthesize("hello"):
                received.append(chunk.audio)
        # Chunks produced before the failure were still streamed out.
        assert received == [b"\x00\x01\x02\x03"]


# -----------------------------------------------------------------
# Local / cloud provider bodies — the factory tests above only
# construct these wrappers. The transcribe/synthesize paths lazy-import
# their SDKs, so the suites inject fakes and exercise the buffering,
# fallback, and chunking logic without the wheels installed.
# -----------------------------------------------------------------


class _WhisperSeg:
    def __init__(self, text: str, words: Any = None, logprob: Any = -0.2) -> None:
        self.text = text
        self.avg_logprob = logprob
        if words is not _MISSING:
            self.words = words


_MISSING = object()


class _WhisperModel:
    instances: list["_WhisperModel"] = []

    def __init__(self, name: str, device: str, compute_type: str) -> None:
        self.name = name
        self.device = device
        self.compute_type = compute_type
        self.calls: list[tuple[Any, str]] = []
        _WhisperModel.instances.append(self)

    def transcribe(self, pcm: Any, **kwargs: Any) -> tuple[list[_WhisperSeg], None]:
        self.calls.append((pcm, kwargs["language"]))
        return [
            _WhisperSeg(
                " hello ",
                [
                    SimpleNamespace(word=" hello", start=0.1, end=0.4),
                    SimpleNamespace(word="nope", start=float("nan"), end=0.5),
                ],
            ),
            _WhisperSeg("   ", []),
            _WhisperSeg("world", logprob=None),
        ], None


class TestWhisperLocalTranscribe:
    def setup_method(self) -> None:
        _WhisperModel.instances.clear()

    def _install(self, monkeypatch: Any) -> None:
        monkeypatch.setitem(
            sys.modules,
            "faster_whisper",
            SimpleNamespace(WhisperModel=_WhisperModel),
        )

    async def test_transcribes_buffered_pcm(self, monkeypatch: Any) -> None:
        self._install(monkeypatch)
        provider = WhisperLocalSTT(model="tiny.en", device="cpu", compute_type="int8")

        async def frames():
            yield b"\x00\x01" * 8
            yield b"\x02\x03" * 8

        results = [r async for r in provider.transcribe(frames(), language="en")]

        assert [r.text for r in results] == ["hello", "world"]
        assert all(r.is_final for r in results)
        assert results[0].words == [("hello", 0.1, 0.4)]
        assert results[0].confidence == -0.2
        assert results[1].words == []
        assert results[1].confidence == 0.0
        model = _WhisperModel.instances[0]
        assert model.name == "tiny.en"
        assert model.calls[0][1] == "en"
        assert model.calls[0][0].shape == (16,)

        # Model stays loaded across utterances, then aclose drops it.
        again = [r async for r in provider.transcribe(frames())]
        assert len(again) == 2
        assert len(_WhisperModel.instances) == 1
        assert model.calls[1][1] == "en"
        await provider.aclose()
        assert provider._model is None

    async def test_empty_audio_yields_nothing(self, monkeypatch: Any) -> None:
        self._install(monkeypatch)
        provider = WhisperLocalSTT()

        async def frames():
            yield b""

        assert [r async for r in provider.transcribe(frames())] == []
        assert _WhisperModel.instances  # model still loads before the empty check


class _SpeechResponse:
    def __init__(self, pieces: list[bytes]) -> None:
        self._pieces = pieces

    async def iter_bytes(self, chunk_size: int = 4096):
        assert chunk_size == 4096
        for piece in self._pieces:
            yield piece


class _SpeechAPI:
    def __init__(self, pieces: list[bytes]) -> None:
        self.pieces = pieces
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> _SpeechResponse:
        self.calls.append(kwargs)
        return _SpeechResponse(self.pieces)


class _AsyncOpenAI:
    constructed: list["_AsyncOpenAI"] = []

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.speech = _SpeechAPI([b"", b"\x01\x02", b"\x03\x04"])
        self.closed = False
        _AsyncOpenAI.constructed.append(self)

    @property
    def audio(self) -> Any:
        return SimpleNamespace(speech=self.speech)

    async def close(self) -> None:
        self.closed = True


class TestOpenAITTSSynthesize:
    def setup_method(self) -> None:
        _AsyncOpenAI.constructed.clear()

    async def test_streams_pcm_and_reuses_client(self, monkeypatch: Any) -> None:
        monkeypatch.setattr("openai.AsyncOpenAI", _AsyncOpenAI)
        provider = OpenAITTS(
            api_key="sk-fake",
            base_url="https://api.openai.com/v1",
            persona_config={"voice": "echo", "speed": 1.05},
            default_headers={"X-Title": "CareerSIM"},
        )

        chunks = [c async for c in provider.synthesize("hello", voice_override="nova")]
        assert [(c.audio, c.is_final, c.sample_rate) for c in chunks] == [
            (b"\x01\x02", False, 24000),
            (b"\x03\x04", True, 24000),
        ]
        client = _AsyncOpenAI.constructed[0]
        assert client.kwargs["base_url"] == "https://api.openai.com/v1"
        assert client.kwargs["default_headers"] == {"X-Title": "CareerSIM"}
        assert client.speech.calls[0]["voice"] == "nova"
        assert client.speech.calls[0]["speed"] == 1.05
        assert client.speech.calls[0]["response_format"] == "pcm"

        # Second call keeps the same client and falls back to the persona voice.
        again = [c async for c in provider.synthesize("again")]
        assert len(again) == 2
        assert len(_AsyncOpenAI.constructed) == 1
        assert client.speech.calls[1]["voice"] == "echo"

        await provider.aclose()
        assert client.closed is True
        assert provider._client is None
        await provider.aclose()

    async def test_bare_client_and_empty_body(self, monkeypatch: Any) -> None:
        class _EmptyClient(_AsyncOpenAI):
            def __init__(self, **kwargs: Any) -> None:
                super().__init__(**kwargs)
                self.speech = _SpeechAPI([b"", b""])

        monkeypatch.setattr("openai.AsyncOpenAI", _EmptyClient)
        provider = OpenAITTS(api_key="sk-fake")
        assert [c async for c in provider.synthesize("hi")] == []
        assert _EmptyClient.constructed[-1].kwargs == {"api_key": "sk-fake"}


class _DGConnection:
    def __init__(self) -> None:
        self.handlers: dict[str, Any] = {}
        self.sent: list[bytes] = []
        self.started: Any = None
        self.finish_count = 0

    def on(self, event: str, callback: Any) -> None:
        self.handlers[event] = callback

    async def start(self, opts: Any) -> None:
        self.started = opts

    async def send(self, frame: bytes) -> None:
        self.sent.append(frame)
        if frame != b"audio":
            return
        interim = SimpleNamespace(
            transcript="hel",
            confidence=None,
        )
        final = SimpleNamespace(
            transcript=" hello ",
            words=[SimpleNamespace(word="hello", start=0.0, end=0.3)],
            confidence=0.9,
        )
        await self.handlers["transcript"](
            None,
            SimpleNamespace(channel=SimpleNamespace(alternatives=[interim]), is_final=False),
        )
        await self.handlers["transcript"](
            None,
            SimpleNamespace(channel=SimpleNamespace(alternatives=[final]), is_final=True),
        )
        blank = SimpleNamespace(transcript="   ", words=[], confidence=0.0)
        await self.handlers["transcript"](
            None,
            SimpleNamespace(channel=SimpleNamespace(alternatives=[blank]), is_final=False),
        )

    async def finish(self) -> None:
        self.finish_count += 1
        close = self.handlers.get("close")
        if close is not None:
            await close()


class TestDeepgramTranscribe:
    def _install(self, monkeypatch: Any, connection: _DGConnection) -> None:
        class DeepgramClient:
            def __init__(self, api_key: str) -> None:
                self.api_key = api_key
                self.listen = SimpleNamespace(
                    asynclive=SimpleNamespace(v=lambda version: connection)
                )

        monkeypatch.setitem(
            sys.modules,
            "deepgram",
            SimpleNamespace(
                DeepgramClient=DeepgramClient,
                LiveOptions=lambda **kwargs: SimpleNamespace(**kwargs),
                LiveTranscriptionEvents=SimpleNamespace(Transcript="transcript", Close="close"),
            ),
        )

    async def test_streams_partial_and_final(self, monkeypatch: Any) -> None:
        connection = _DGConnection()
        self._install(monkeypatch, connection)
        provider = DeepgramSTT(api_key="dg-fake", model="nova-3")

        async def frames():
            yield b"audio"
            yield b"more"

        results = [r async for r in provider.transcribe(frames(), language="es")]

        assert [(r.text, r.is_final, r.confidence, r.words) for r in results] == [
            ("hel", False, 0.0, []),
            ("hello", True, 0.9, [("hello", 0.0, 0.3)]),
        ]
        assert connection.sent == [b"audio", b"more"]
        assert connection.started.language == "es"
        assert connection.started.model == "nova-3"
        assert connection.finish_count == 1
        assert provider._connection is None

        # Client is reused; default language fills in when omitted.
        async def more_frames():
            yield b"audio"

        again = [r async for r in provider.transcribe(more_frames())]
        assert len(again) == 2
        assert connection.started.language == "en-US"

    async def test_aclose_finishes_open_connection(self) -> None:
        connection = _DGConnection()
        provider = DeepgramSTT(api_key="dg-fake")
        provider._connection = connection
        provider._client = object()
        await provider.aclose()
        assert connection.finish_count == 1
        assert provider._connection is None
        assert provider._client is None
        await provider.aclose()


class _PiperChunk:
    def __init__(self, pcm: bytes) -> None:
        self.audio_int16_bytes = pcm


class _PiperVoice:
    def __init__(self, sample_rate: Any) -> None:
        self.config = SimpleNamespace(sample_rate=sample_rate) if sample_rate is not None else None
        self.texts: list[str] = []

    def synthesize(self, text: str):
        self.texts.append(text)
        yield _PiperChunk(b"\x01\x02")
        yield _PiperChunk(b"\x03\x04")


class TestPiperVoiceLoading:
    def _install(self, monkeypatch: Any, voice: _PiperVoice) -> list[str]:
        loaded: list[str] = []

        class PiperVoice:
            @staticmethod
            def load(path: str) -> _PiperVoice:
                loaded.append(path)
                return voice

        monkeypatch.setitem(sys.modules, "piper", SimpleNamespace(PiperVoice=PiperVoice))
        return loaded

    def test_missing_persona_voice_falls_back(self, tmp_path: Any, monkeypatch: Any) -> None:
        default = tmp_path / "en_US-libritts_r-medium.onnx"
        default.write_bytes(b"model")
        voice = _PiperVoice(16000)
        loaded = self._install(monkeypatch, voice)

        provider = PiperLocalTTS(
            str(tmp_path),
            "en_US-libritts_r-medium",
            {"voiceModel": "en_US-ryan-high"},
        )
        assert provider.output_sample_rate() == 16000
        assert provider._persona_voice == "en_US-libritts_r-medium"
        assert loaded == [str(default)]

    def test_missing_default_voice_raises(self, tmp_path: Any, monkeypatch: Any) -> None:
        self._install(monkeypatch, _PiperVoice(22050))
        provider = PiperLocalTTS(str(tmp_path), "not-on-disk")
        with pytest.raises(FileNotFoundError, match="Piper voice model not found"):
            provider.output_sample_rate()

    def test_onnx_path_skips_existence_check(self, tmp_path: Any, monkeypatch: Any) -> None:
        voice = _PiperVoice(None)
        loaded = self._install(monkeypatch, voice)
        provider = PiperLocalTTS(str(tmp_path), "ignored", {"voiceModel": "custom.onnx"})
        assert provider.output_sample_rate() == 22050
        assert loaded == ["custom.onnx"]

    async def test_synthesize_marks_last_chunk_final(self, tmp_path: Any, monkeypatch: Any) -> None:
        voice = _PiperVoice(22050)
        self._install(monkeypatch, voice)
        model = tmp_path / "voice.onnx"
        model.write_bytes(b"model")
        provider = PiperLocalTTS(str(tmp_path), "voice")

        chunks = [c async for c in provider.synthesize("hello")]
        assert [(c.audio, c.is_final, c.sample_rate) for c in chunks] == [
            (b"\x01\x02", False, 22050),
            (b"\x03\x04", True, 22050),
        ]
        assert voice.texts == ["hello"]

        # Override drops the loaded voice and resolves the new path as absolute.
        override = tmp_path / "other.onnx"
        chunks = [c async for c in provider.synthesize("again", voice_override=str(override))]
        assert len(chunks) == 2
        assert provider._persona_voice == str(override)

        await provider.aclose()
        assert provider._voice is None

    async def test_legacy_chunk_bytes(self) -> None:
        class _LegacyVoice:
            def synthesize(self, text: str):
                yield b"\x0a\x0b"

        provider = PiperLocalTTS("/tmp", "x")
        provider._voice = _LegacyVoice()
        chunks = [c async for c in provider.synthesize("hi")]
        assert len(chunks) == 1
        assert chunks[0].audio == b"\x0a\x0b"
        assert chunks[0].is_final is True


class _Transcriptions:
    def __init__(self, resp: Any) -> None:
        self.resp = resp
        self.kwargs: Any = None

    async def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        return self.resp


class _WhisperClient:
    constructed: list["_WhisperClient"] = []

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.transcriptions = _Transcriptions(
            SimpleNamespace(
                text=" hello ",
                words=[
                    {"word": " hello", "start": 0.0, "end": 0.2},
                    {"start": 0.2},
                    "nope",
                    {"word": "x", "start": "bad", "end": 1},
                ],
            )
        )
        self.closed = False
        _WhisperClient.constructed.append(self)

    @property
    def audio(self) -> Any:
        return SimpleNamespace(transcriptions=self.transcriptions)

    async def close(self) -> None:
        self.closed = True


class TestWhisperOpenAISdkPath:
    def setup_method(self) -> None:
        _WhisperClient.constructed.clear()
        _openrouter_limiter.reset()

    async def test_openai_multipart_upload(self, monkeypatch: Any) -> None:
        monkeypatch.setattr("openai.AsyncOpenAI", _WhisperClient)
        provider = WhisperOpenAISTT(
            api_key="sk-fake",
            base_url="https://api.openai.com/v1",
            model="whisper-1",
            default_headers={"X-Title": "CareerSIM"},
        )
        assert provider.input_sample_rate() == 16000

        async def frames():
            yield b"\x00\x01" * 8

        results = [r async for r in provider.transcribe(frames(), language="en")]
        assert len(results) == 1
        assert results[0].text == "hello"
        assert results[0].words == [("hello", 0.0, 0.2)]
        assert results[0].confidence is None
        client = _WhisperClient.constructed[0]
        assert client.kwargs["base_url"] == "https://api.openai.com/v1"
        assert client.kwargs["default_headers"] == {"X-Title": "CareerSIM"}
        upload = client.transcriptions.kwargs
        assert upload["model"] == "whisper-1"
        assert upload["file"].name == "audio.wav"
        assert upload["response_format"] == "verbose_json"

        # Cached client, and a blank transcript yields nothing.
        client.transcriptions.resp = SimpleNamespace(text="   ", words=None)
        assert [r async for r in provider.transcribe(frames())] == []
        assert len(_WhisperClient.constructed) == 1

        await provider.aclose()
        assert client.closed is True
        assert provider._client is None

    async def test_empty_audio_skips_the_request(self, monkeypatch: Any) -> None:
        monkeypatch.setattr("openai.AsyncOpenAI", _WhisperClient)
        provider = WhisperOpenAISTT(api_key="sk-fake")

        async def frames():
            if False:
                yield b""

        assert [r async for r in provider.transcribe(frames())] == []
        assert _WhisperClient.constructed == []

    async def test_http_client_and_aclose(self) -> None:
        provider = WhisperOpenAISTT(
            api_key="sk-fake",
            base_url="https://openrouter.ai/api/v1/",
            default_headers={"X-Title": "CareerSIM"},
        )
        http = provider._ensure_http()
        assert provider._ensure_http() is http
        assert http.headers["x-title"] == "CareerSIM"
        bare = WhisperOpenAISTT(api_key="sk-bare")
        assert bare._ensure_http().base_url == ""
        await provider.aclose()
        await bare.aclose()
        assert provider._http is None

    async def test_openrouter_runtime_error_is_not_wrapped(self) -> None:
        provider = WhisperOpenAISTT(
            api_key="sk-or",
            base_url="https://openrouter.ai/api/v1",
        )

        class _Boom:
            async def post(self, url: str, *, json: dict[str, Any]) -> Any:
                raise RuntimeError("limiter exploded")

        provider._ensure_http = lambda: _Boom()  # type: ignore[method-assign]

        async def frames():
            yield b"\x00\x01" * 8

        with pytest.raises(RuntimeError, match="limiter exploded"):
            [r async for r in provider.transcribe(frames())]

    def test_retry_delay_ignores_non_numeric_header(self) -> None:
        from careersim_agent.voice.providers.whisper_openai import (
            _log_rate_limit_headers,
            _retry_delay_seconds,
        )

        bogus = _FakeResponse({}, headers={"Retry-After": "soon", "X-Request-Id": "abc"})
        assert _retry_delay_seconds(bogus, 2) == 2.0
        capped = _FakeResponse({}, headers={"Retry-After": "30"})
        assert _retry_delay_seconds(capped, 1) == 8.0
        _log_rate_limit_headers(_FakeResponse({}, headers={"Content-Type": "application/json"}))


class TestProtocolConformance:
    def test_stt_impls_satisfy_protocol(self) -> None:
        impls = [
            WhisperLocalSTT(),
            WhisperOpenAISTT(api_key="sk-fake"),
            DeepgramSTT(api_key="dg-fake"),
        ]
        for impl in impls:
            assert isinstance(impl, STTProvider), f"{impl.name} fails STTProvider"

    def test_tts_impls_satisfy_protocol(self) -> None:
        impls = [
            PiperLocalTTS(model_dir="/tmp", default_voice="x"),
            OpenAITTS(api_key="sk-fake"),
            ElevenLabsTTS(api_key="el-fake", persona_config={"voiceId": "vid"}),
        ]
        for impl in impls:
            assert isinstance(impl, TTSProvider), f"{impl.name} fails TTSProvider"
