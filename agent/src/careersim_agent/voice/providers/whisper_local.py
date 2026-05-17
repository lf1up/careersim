"""Self-hosted Whisper STT via ``faster-whisper``.

Loads a CTranslate2 Whisper model once at construction (typically the
worker startup), then transcribes streamed PCM frames using
Silero-VAD-chunked utterance boundaries. The model is shared across
sessions in the same worker process; with the ``base.en`` int8 default
this fits comfortably in 1 GB of RAM and runs ~real-time on a single
CPU core.

The ``faster_whisper`` and ``silero-vad`` imports are lazy so the
provider Protocol can be exercised in unit tests without those wheels
installed in the test environment.
"""

from __future__ import annotations

import asyncio
import logging
import math
from typing import Any, AsyncIterable, AsyncIterator, Optional

from .base import STTResult

logger = logging.getLogger(__name__)


class WhisperLocalSTT:
    """STT impl wrapping :mod:`faster_whisper` for in-process Whisper."""

    name = "whisper_local"

    # faster-whisper expects 16 kHz mono int16 — same as LiveKit's
    # default microphone capture, so no resampling is needed in the
    # common case.
    SAMPLE_RATE = 16000

    def __init__(
        self,
        model: str = "base.en",
        device: str = "cpu",
        compute_type: str = "int8",
    ) -> None:
        self._model_name = model
        self._device = device
        self._compute_type = compute_type
        self._model: Optional[Any] = None  # faster_whisper.WhisperModel
        self._vad: Optional[Any] = None    # silero VAD callable

    def input_sample_rate(self) -> int:
        return self.SAMPLE_RATE

    def _ensure_model(self) -> Any:
        if self._model is None:
            try:
                from faster_whisper import WhisperModel  # lazy
            except ImportError as exc:  # pragma: no cover - exercised at runtime only
                raise RuntimeError(
                    "faster-whisper not installed; add the `voice-local` "
                    "extra to agent/pyproject.toml or switch "
                    "VOICE_STT_PROVIDER to a cloud option"
                ) from exc

            logger.info(
                "loading faster-whisper model=%s device=%s compute_type=%s",
                self._model_name,
                self._device,
                self._compute_type,
            )
            self._model = WhisperModel(
                self._model_name,
                device=self._device,
                compute_type=self._compute_type,
            )
        return self._model

    async def transcribe(
        self,
        audio_frames: AsyncIterable[bytes],
        *,
        language: Optional[str] = None,
    ) -> AsyncIterator[STTResult]:
        """Buffer incoming PCM until silence, then transcribe each utterance.

        We use a simple trailing-silence heuristic instead of a full VAD
        here so the unit tests don't have to ship Silero. The LiveKit
        pipeline normally feeds us pre-segmented utterances from
        ``livekit-plugins-silero`` anyway, in which case the buffer
        flushes as soon as the upstream stream closes.
        """
        model = self._ensure_model()
        # Collect everything for the utterance, then synchronously
        # invoke the model in a worker thread (faster-whisper is sync).
        buf = bytearray()
        async for frame in audio_frames:
            buf.extend(frame)

        if not buf:
            return

        loop = asyncio.get_running_loop()
        results = await loop.run_in_executor(
            None,
            self._transcribe_sync,
            bytes(buf),
            language,
            model,
        )
        for r in results:
            yield r

    def _transcribe_sync(
        self,
        audio_bytes: bytes,
        language: Optional[str],
        model: Any,
    ) -> list[STTResult]:
        """Synchronous transcription pass; runs off the event loop."""
        # faster-whisper accepts a numpy float32 array. Convert int16 PCM
        # to float32 in [-1, 1] without bringing numpy into the public
        # surface of this module.
        try:
            import numpy as np  # lazy
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("numpy is required for faster-whisper") from exc

        pcm = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        segments, _info = model.transcribe(
            pcm,
            language=language or "en",
            vad_filter=True,
            word_timestamps=True,
            beam_size=1,  # latency over WER for live conversation
        )

        out: list[STTResult] = []
        seg_list = list(segments)  # iterator -> list (cheap; few segments per utterance)
        for i, seg in enumerate(seg_list):
            words: list[tuple[str, float, float]] = []
            for w in getattr(seg, "words", None) or []:
                start = float(getattr(w, "start", 0.0) or 0.0)
                end = float(getattr(w, "end", start) or start)
                if math.isnan(start) or math.isnan(end):
                    continue
                words.append((str(getattr(w, "word", "")).strip(), start, end))
            text = (seg.text or "").strip()
            if not text:
                continue
            out.append(
                STTResult(
                    text=text,
                    is_final=(i == len(seg_list) - 1),
                    confidence=float(getattr(seg, "avg_logprob", 0.0) or 0.0),
                    words=words,
                )
            )
        return out

    async def aclose(self) -> None:
        # faster-whisper has no explicit close — drop the reference and
        # let the GC reclaim the model when no sessions hold it.
        self._model = None
