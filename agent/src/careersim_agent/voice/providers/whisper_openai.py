"""OpenAI-compatible Whisper STT (cloud) — `/v1/audio/transcriptions`.

Pseudo-streaming: the transcription endpoint is a single POST per
utterance, not a true streaming socket, so we buffer the full
utterance and submit it at end-of-speech. Latency is dominated by the
audio length itself (typical 5–10s utterance -> ~400 ms transcription
RTT).

Reuses the ``OPENAI_API_KEY`` / ``OPENAI_BASE_URL`` already configured
for the chat path — no new account or env var is required to switch
to this provider.

OpenRouter quirk: when ``OPENAI_BASE_URL`` points at OpenRouter, the
OpenAI SDK's ``multipart/form-data`` upload is rejected with a 400
(``invalid content-type``). OpenRouter instead expects a JSON body with
the audio base64-encoded under ``input_audio``. We detect that base URL
and switch to a plain ``httpx`` JSON POST, so the same provider works
against both real OpenAI and OpenRouter without a separate impl.
"""

from __future__ import annotations

import base64
import io
import logging
import wave
from typing import Any, AsyncIterable, AsyncIterator, Optional

import httpx

from .base import STTResult, is_openrouter_base_url

logger = logging.getLogger(__name__)


class WhisperOpenAISTT:
    """STT impl posting full utterances to OpenAI's whisper endpoint."""

    name = "whisper_openai"
    SAMPLE_RATE = 16000

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        model: str = "whisper-1",
        default_headers: Optional[dict] = None,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._model = model
        self._default_headers = default_headers or {}
        self._client = None
        self._http: Optional[httpx.AsyncClient] = None

    def input_sample_rate(self) -> int:
        return self.SAMPLE_RATE

    def _ensure_client(self):
        if self._client is None:
            try:
                from openai import AsyncOpenAI  # lazy
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "openai SDK not installed; needed for whisper_openai STT"
                ) from exc

            kwargs: dict = {"api_key": self._api_key}
            if self._base_url:
                kwargs["base_url"] = self._base_url
            if self._default_headers:
                kwargs["default_headers"] = self._default_headers
            self._client = AsyncOpenAI(**kwargs)
        return self._client

    def _ensure_http(self) -> httpx.AsyncClient:
        if self._http is None:
            headers = {
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                **self._default_headers,
            }
            self._http = httpx.AsyncClient(
                base_url=(self._base_url or "").rstrip("/"),
                headers=headers,
                timeout=60.0,
            )
        return self._http

    async def transcribe(
        self,
        audio_frames: AsyncIterable[bytes],
        *,
        language: Optional[str] = None,
    ) -> AsyncIterator[STTResult]:
        # Buffer the full utterance, wrap in a WAV header. The endpoint
        # requires a real audio container, not raw PCM.
        buf = bytearray()
        async for frame in audio_frames:
            buf.extend(frame)
        if not buf:
            return

        wav_bytes = _pcm16_to_wav(bytes(buf), self.SAMPLE_RATE)

        if is_openrouter_base_url(self._base_url):
            text, words = await self._transcribe_openrouter(wav_bytes, language)
        else:
            text, words = await self._transcribe_openai(wav_bytes, language)

        text = (text or "").strip()
        if not text:
            return

        yield STTResult(
            text=text,
            is_final=True,
            confidence=None,  # not exposed by this endpoint
            words=words,
        )

    async def _transcribe_openai(
        self, wav_bytes: bytes, language: Optional[str]
    ) -> tuple[str, list[tuple[str, float, float]]]:
        """OpenAI / OpenAI-compatible path: SDK multipart upload."""
        client = self._ensure_client()
        # The SDK expects a file-like with a name attribute.
        file_obj = io.BytesIO(wav_bytes)
        file_obj.name = "audio.wav"

        try:
            resp = await client.audio.transcriptions.create(
                model=self._model,
                file=file_obj,
                language=language or "en",
                response_format="verbose_json",
                temperature=0,
            )
        except Exception as exc:  # pragma: no cover - network path
            logger.exception("OpenAI transcription failed")
            raise RuntimeError(f"OpenAI STT failed: {exc}") from exc

        text = getattr(resp, "text", "") or ""
        words: list[tuple[str, float, float]] = []
        # `verbose_json` may return word-level timing under `words` (newer
        # models) or be empty (whisper-1). Treat both as best-effort.
        for w in getattr(resp, "words", None) or []:
            try:
                words.append((str(w["word"]).strip(), float(w["start"]), float(w["end"])))
            except (KeyError, TypeError, ValueError):
                continue
        return text, words

    async def _transcribe_openrouter(
        self, wav_bytes: bytes, language: Optional[str]
    ) -> tuple[str, list[tuple[str, float, float]]]:
        """OpenRouter path: JSON body with base64 audio (no multipart)."""
        http = self._ensure_http()
        payload: dict[str, Any] = {
            "model": self._model,
            "input_audio": {
                "data": base64.b64encode(wav_bytes).decode("ascii"),
                "format": "wav",
            },
            "language": language or "en",
        }
        try:
            resp = await http.post("/audio/transcriptions", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # pragma: no cover - network path
            logger.exception("OpenRouter transcription failed")
            raise RuntimeError(f"OpenRouter STT failed: {exc}") from exc

        text = (data.get("text") if isinstance(data, dict) else "") or ""
        # OpenRouter's transcription response is text-only (no word timing).
        return text, []

    async def aclose(self) -> None:
        if self._client is not None:
            try:
                await self._client.close()
            except Exception:  # pragma: no cover
                pass
            self._client = None
        if self._http is not None:
            try:
                await self._http.aclose()
            except Exception:  # pragma: no cover
                pass
            self._http = None


def _pcm16_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    """Wrap raw int16-mono PCM in a minimal WAV header."""
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return out.getvalue()
