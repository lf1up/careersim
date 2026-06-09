"""OpenAI-compatible TTS via ``/v1/audio/speech`` (cloud).

Streams 24 kHz mono PCM as the response body arrives. Reuses the
chat-side ``OPENAI_API_KEY`` / ``OPENAI_BASE_URL`` so flipping
``VOICE_TTS_PROVIDER=openai_tts`` doesn't require any new account.

OpenRouter's ``/audio/speech`` is OpenAI-SDK-compatible, so the only
quirk is that it needs an OpenRouter model slug (e.g.
``openai/gpt-4o-mini-tts``) rather than a bare OpenAI model id. When
``OPENAI_BASE_URL`` points at OpenRouter we swap in ``openrouter_model``;
everything else (the SDK call, the PCM streaming) is unchanged.
"""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Optional

from .base import TTSAudioChunk, is_openrouter_base_url

logger = logging.getLogger(__name__)


class OpenAITTS:
    """OpenAI text-to-speech provider."""

    name = "openai_tts"

    # OpenAI's `pcm` response format is fixed at 24 kHz, mono, 16-bit.
    SAMPLE_RATE = 24000

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        persona_config: Optional[dict[str, Any]] = None,
        model: str = "gpt-4o-mini-tts",
        openrouter_model: str = "openai/gpt-4o-mini-tts",
        default_headers: Optional[dict] = None,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._persona_voice = (persona_config or {}).get("voice") or "alloy"
        self._persona_speed = float((persona_config or {}).get("speed") or 1.0)
        # OpenRouter needs a namespaced model slug; real OpenAI a bare id.
        self._model = (
            openrouter_model if is_openrouter_base_url(base_url) else model
        )
        self._default_headers = default_headers or {}
        self._client = None

    def output_sample_rate(self) -> int:
        return self.SAMPLE_RATE

    def _ensure_client(self):
        if self._client is None:
            try:
                from openai import AsyncOpenAI  # lazy
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "openai SDK not installed; needed for openai_tts"
                ) from exc

            kwargs: dict = {"api_key": self._api_key}
            if self._base_url:
                kwargs["base_url"] = self._base_url
            if self._default_headers:
                kwargs["default_headers"] = self._default_headers
            self._client = AsyncOpenAI(**kwargs)
        return self._client

    async def synthesize(
        self,
        text: str,
        *,
        voice_override: Optional[str] = None,
    ) -> AsyncIterator[TTSAudioChunk]:
        client = self._ensure_client()
        voice = voice_override or self._persona_voice

        try:
            response = await client.audio.speech.create(
                model=self._model,
                voice=voice,
                input=text,
                response_format="pcm",
                speed=self._persona_speed,
            )
        except Exception as exc:  # pragma: no cover - network
            logger.exception("OpenAI TTS request failed")
            raise RuntimeError(f"OpenAI TTS failed: {exc}") from exc

        # The OpenAI SDK's streaming response exposes chunks via
        # `iter_bytes()`. We yield each chunk as a TTSAudioChunk and
        # mark the last one final after the iterator is exhausted.
        last_chunk: Optional[bytes] = None
        async for piece in response.iter_bytes(chunk_size=4096):
            if not piece:
                continue
            if last_chunk is not None:
                yield TTSAudioChunk(
                    audio=last_chunk,
                    sample_rate=self.SAMPLE_RATE,
                    is_final=False,
                )
            last_chunk = piece
        if last_chunk is not None:
            yield TTSAudioChunk(
                audio=last_chunk,
                sample_rate=self.SAMPLE_RATE,
                is_final=True,
            )

    async def aclose(self) -> None:
        if self._client is not None:
            try:
                await self._client.close()
            except Exception:  # pragma: no cover
                pass
            self._client = None
