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
        # Resolved from the loaded voice's config (falls back to the
        # libritts_r-medium default). Set in `_ensure_voice`.
        self._sample_rate = self.SAMPLE_RATE

    def output_sample_rate(self) -> int:
        # Make sure the voice (and thus its real sample rate) is loaded so
        # callers publishing an audio track size their source correctly.
        self._ensure_voice()
        return self._sample_rate

    def _ensure_voice(self) -> Any:
        if self._voice is None:
            try:
                from piper import PiperVoice  # lazy
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError(
                    "piper-tts not installed; needed for piper_local TTS"
                ) from exc

            voice_id = self._persona_voice
            try:
                model_path = self._resolve_model_path(voice_id)
            except FileNotFoundError:
                # A persona pinned a voice whose model isn't on disk.
                # Rather than crash the whole job (which happens *before*
                # the mic pipeline is wired, so it also kills STT and the
                # transcript), degrade to the default voice — which is
                # prefetched into the image and therefore always present.
                # Only a missing *default* is a hard error worth raising.
                if voice_id == self._default_voice:
                    raise
                logger.warning(
                    "piper voice %s missing; falling back to default %s. "
                    "Run agent/scripts/prefetch_voice_models.py to restore "
                    "the persona's intended voice.",
                    voice_id,
                    self._default_voice,
                )
                voice_id = self._default_voice
                self._persona_voice = voice_id
                model_path = self._resolve_model_path(voice_id)
            logger.info("loading piper voice %s from %s", voice_id, model_path)
            self._voice = PiperVoice.load(str(model_path))
            # piper-tts >= 1.3 exposes the model sample rate on the voice
            # config; older constants were hard-coded. Read it so voices
            # that aren't 22050 Hz don't get pitch-shifted on playback.
            config = getattr(self._voice, "config", None)
            rate = getattr(config, "sample_rate", None)
            if isinstance(rate, int) and rate > 0:
                self._sample_rate = rate
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
        rate = self._sample_rate
        loop = asyncio.get_running_loop()

        # piper-tts >= 1.3 replaced the old `synthesize_stream_raw` byte
        # generator with `synthesize(text)`, which yields `AudioChunk`
        # objects exposing the int16 PCM via `.audio_int16_bytes`. Run the
        # sync generator in an executor and bridge each chunk back into the
        # async caller.
        #
        # The queue is unbounded and the producer enqueues via
        # `call_soon_threadsafe` rather than blocking on
        # `run_coroutine_threadsafe(...).result()`. A blocking put would
        # hang the executor thread forever if the consumer is cancelled
        # while the queue is full (nothing drains it, so the future never
        # resolves), leaking a thread per cancelled call. A bounded queue
        # with drop-on-full isn't an option either: piper synthesises
        # faster than real-time playback, so the buffer fills on nearly
        # every utterance and we'd drop audio. Buffering a single
        # utterance's PCM (~44 KB/s) is cheap, so stay unbounded.
        queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue()

        def producer() -> None:
            try:
                for chunk in voice.synthesize(text):
                    pcm = getattr(chunk, "audio_int16_bytes", None)
                    if pcm is None:  # very old API fallback
                        pcm = bytes(chunk)
                    loop.call_soon_threadsafe(queue.put_nowait, bytes(pcm))
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        loop.run_in_executor(None, producer)

        last: Optional[bytes] = None
        while True:
            item = await queue.get()
            if item is None:
                if last is not None:
                    yield TTSAudioChunk(
                        audio=last,
                        sample_rate=rate,
                        is_final=True,
                    )
                return
            if last is not None:
                yield TTSAudioChunk(
                    audio=last,
                    sample_rate=rate,
                    is_final=False,
                )
            last = item

    async def aclose(self) -> None:
        # Nothing to close — drop the voice handle.
        self._voice = None
