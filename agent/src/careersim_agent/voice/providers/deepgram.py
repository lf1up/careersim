"""Deepgram Nova-3 streaming STT (cloud, opt-in).

True streaming over a websocket; lowest latency of the three STT
options (~150 ms partial, ~300 ms final on Nova-3 in our smoke
tests). Requires ``DEEPGRAM_API_KEY``; gated by the factory in
:mod:`..providers.__init__`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterable, AsyncIterator, Optional

from .base import STTResult

logger = logging.getLogger(__name__)


class DeepgramSTT:
    """Streaming STT against Deepgram's Nova-3 model."""

    name = "deepgram"
    SAMPLE_RATE = 16000

    def __init__(
        self,
        api_key: str,
        model: str = "nova-3",
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._client = None
        self._connection: Any = None

    def input_sample_rate(self) -> int:
        return self.SAMPLE_RATE

    def _ensure_client(self):
        if self._client is None:
            try:
                from deepgram import DeepgramClient  # lazy
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "deepgram-sdk not installed; needed for deepgram STT"
                ) from exc
            self._client = DeepgramClient(self._api_key)
        return self._client

    async def transcribe(
        self,
        audio_frames: AsyncIterable[bytes],
        *,
        language: Optional[str] = None,
    ) -> AsyncIterator[STTResult]:
        client = self._ensure_client()
        try:
            from deepgram import LiveOptions, LiveTranscriptionEvents  # lazy
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("deepgram-sdk missing live module") from exc

        connection = client.listen.asynclive.v("1")
        self._connection = connection

        results_q: asyncio.Queue[Optional[STTResult]] = asyncio.Queue()

        async def on_message(_self, result, **_kwargs) -> None:
            try:
                alt = result.channel.alternatives[0]
                text = (alt.transcript or "").strip()
                if not text:
                    return
                words = [
                    (w.word, float(w.start), float(w.end))
                    for w in getattr(alt, "words", []) or []
                ]
                await results_q.put(
                    STTResult(
                        text=text,
                        is_final=bool(getattr(result, "is_final", False)),
                        confidence=float(getattr(alt, "confidence", 0.0) or 0.0),
                        words=words,
                    )
                )
            except Exception:  # pragma: no cover
                logger.exception("deepgram on_message failed")

        async def on_close(*_a, **_kw) -> None:
            await results_q.put(None)  # sentinel

        connection.on(LiveTranscriptionEvents.Transcript, on_message)
        connection.on(LiveTranscriptionEvents.Close, on_close)

        opts = LiveOptions(
            model=self._model,
            language=language or "en-US",
            encoding="linear16",
            sample_rate=self.SAMPLE_RATE,
            channels=1,
            interim_results=True,
            smart_format=True,
            punctuate=True,
        )
        await connection.start(opts)

        async def pump_audio() -> None:
            try:
                async for frame in audio_frames:
                    await connection.send(frame)
            finally:
                await connection.finish()

        pump_task = asyncio.create_task(pump_audio())

        try:
            while True:
                item = await results_q.get()
                if item is None:
                    break
                yield item
        finally:
            await pump_task
            self._connection = None

    async def aclose(self) -> None:
        if self._connection is not None:
            try:
                await self._connection.finish()
            except Exception:  # pragma: no cover
                pass
        self._connection = None
        self._client = None
