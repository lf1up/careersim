"""OpenAI Whisper STT (cloud) — `/v1/audio/transcriptions`.

Pseudo-streaming: OpenAI's transcription endpoint is a single POST per
utterance, not a true streaming socket, so we buffer the full
utterance and submit it at end-of-speech. Latency is dominated by the
audio length itself (typical 5–10s utterance -> ~400 ms transcription
RTT to OpenAI).

Reuses the ``OPENAI_API_KEY`` / ``OPENAI_BASE_URL`` already configured
for the chat path — no new account or env var is required to switch
to this provider.
"""

from __future__ import annotations

import io
import logging
import wave
from typing import AsyncIterable, AsyncIterator, Optional

from .base import STTResult

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
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._model = model
        self._client = None

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
            self._client = AsyncOpenAI(**kwargs)
        return self._client

    async def transcribe(
        self,
        audio_frames: AsyncIterable[bytes],
        *,
        language: Optional[str] = None,
    ) -> AsyncIterator[STTResult]:
        client = self._ensure_client()

        # Buffer the full utterance, wrap in a WAV header, ship to OpenAI.
        # OpenAI requires a real audio container, not raw PCM.
        buf = bytearray()
        async for frame in audio_frames:
            buf.extend(frame)
        if not buf:
            return

        wav_bytes = _pcm16_to_wav(bytes(buf), self.SAMPLE_RATE)
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

        text = (getattr(resp, "text", "") or "").strip()
        if not text:
            return

        words: list[tuple[str, float, float]] = []
        # `verbose_json` may return word-level timing under `words` (newer
        # models) or be empty (whisper-1). Treat both as best-effort.
        for w in getattr(resp, "words", None) or []:
            try:
                words.append((str(w["word"]).strip(), float(w["start"]), float(w["end"])))
            except (KeyError, TypeError, ValueError):
                continue

        yield STTResult(
            text=text,
            is_final=True,
            confidence=None,  # not exposed by this endpoint
            words=words,
        )

    async def aclose(self) -> None:
        if self._client is not None:
            try:
                await self._client.close()
            except Exception:  # pragma: no cover
                pass
            self._client = None


def _pcm16_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    """Wrap raw int16-mono PCM in a minimal WAV header."""
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return out.getvalue()
