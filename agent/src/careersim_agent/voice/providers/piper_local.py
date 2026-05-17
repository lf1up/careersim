"""Self-hosted TTS via Piper (https://github.com/rhasspy/piper).

Loads a per-persona voice model (or falls back to the worker's
``VOICE_PIPER_DEFAULT_VOICE``) and streams 22050 Hz mono PCM as the
text is synthesised.

Voice model files live under ``VOICE_PIPER_MODEL_DIR`` (a Docker
volume in compose) so they survive ``docker compose down`` without
re-downloads. The default voice is prefetched into the agent image
during build via ``agent/scripts/prefetch_voice_models.py``.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, AsyncIterator, Optional

from .base import TTSAudioChunk

logger = logging.getLogger(__name__)


class PiperLocalTTS:
    """Wraps :mod:`piper-tts` for in-process TTS."""

    name = "piper_local"

    # Piper's default sample rate for the en_US-libritts_r-medium /
    # en_US-ryan-high voices. Provider chunks declare it explicitly so
    # the pipeline can resample if the LiveKit room is configured for
    # a different rate.
    SAMPLE_RATE = 22050

    def __init__(
        self,
        model_dir: str,
        default_voice: str,
        persona_config: Optional[dict[str, Any]] = None,
    ) -> None:
        self._model_dir = Path(model_dir)
        self._default_voice = default_voice
        self._persona_voice = (
            (persona_config or {}).get("voiceModel") or default_voice
        )
        self._voice: Optional[Any] = None  # piper.PiperVoice

    def output_sample_rate(self) -> int:
        return self.SAMPLE_RATE

    def _ensure_voice(self) -> Any:
        if self._voice is None:
            try:
                from piper import PiperVoice  # lazy
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "piper-tts not installed; needed for piper_local TTS"
                ) from exc

            voice_id = self._persona_voice
            model_path = self._resolve_model_path(voice_id)
            logger.info("loading piper voice %s from %s", voice_id, model_path)
            self._voice = PiperVoice.load(str(model_path))
        return self._voice

    def _resolve_model_path(self, voice_id: str) -> Path:
        """Find the .onnx model file for a Piper voice ID.

        Piper stores voices as ``<voice_id>.onnx`` + a sibling
        ``<voice_id>.onnx.json`` config. We accept either an absolute
        path (for tests) or a bare voice ID resolved against
        ``model_dir``.
        """
        if os.path.isabs(voice_id) or voice_id.endswith(".onnx"):
            return Path(voice_id)

        candidate = self._model_dir / f"{voice_id}.onnx"
        if not candidate.exists():
            raise FileNotFoundError(
                f"Piper voice model not found: {candidate}. "
                "Run agent/scripts/prefetch_voice_models.py to download."
            )
        return candidate

    async def synthesize(
        self,
        text: str,
        *,
        voice_override: Optional[str] = None,
    ) -> AsyncIterator[TTSAudioChunk]:
        if voice_override and voice_override != self._persona_voice:
            self._persona_voice = voice_override
            self._voice = None  # force reload

        voice = self._ensure_voice()
        loop = asyncio.get_running_loop()

        # Piper's `synthesize_stream_raw` is a sync generator yielding
        # chunks of int16 PCM. Run it in an executor and bridge each
        # chunk back into the async caller.
        queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=8)

        def producer() -> None:
            try:
                for chunk in voice.synthesize_stream_raw(text):
                    asyncio.run_coroutine_threadsafe(
                        queue.put(bytes(chunk)), loop
                    ).result()
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(None), loop).result()

        loop.run_in_executor(None, producer)

        last: Optional[bytes] = None
        while True:
            item = await queue.get()
            if item is None:
                if last is not None:
                    yield TTSAudioChunk(
                        audio=last,
                        sample_rate=self.SAMPLE_RATE,
                        is_final=True,
                    )
                return
            if last is not None:
                yield TTSAudioChunk(
                    audio=last,
                    sample_rate=self.SAMPLE_RATE,
                    is_final=False,
                )
            last = item

    async def aclose(self) -> None:
        # Nothing to close — drop the voice handle.
        self._voice = None
