"""ElevenLabs Flash v2.5 streaming TTS (cloud, opt-in, premium).

Connects to ElevenLabs' multi-context websocket and streams 22050 Hz
mono PCM as audio is generated. Lowest perceived latency (~300 ms
first-byte) and the most expressive voices among the three TTS
options — but also the only one that requires its own paid account.
Gated by the factory in :mod:`..providers.__init__`.

Persona config keys consumed:

- ``voiceId`` (required) — ElevenLabs voice ID.
- ``stability`` (0..1) — lower = more expressive but less consistent.
- ``styleExaggeration`` (0..1) — pushes the source voice's style.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any, AsyncIterator, Optional

from .base import TTSAudioChunk

logger = logging.getLogger(__name__)


async def _ws_connect(websockets_mod: Any, url: str, api_key: str) -> Any:
    """Open the ElevenLabs websocket, tolerating the websockets API rename.

    websockets >= 14 (the new ``websockets.asyncio`` client) renamed the
    request-header kwarg from ``extra_headers`` to ``additional_headers``;
    passing the old name now blows up deep in ``loop.create_connection``
    with ``unexpected keyword argument 'extra_headers'``. We try the new
    name first and fall back to the legacy one so the provider works
    across the pinned ``websockets>=12.0`` range.
    """
    headers = {"xi-api-key": api_key}
    try:
        return await websockets_mod.connect(url, additional_headers=headers)
    except TypeError:
        return await websockets_mod.connect(url, extra_headers=headers)


class ElevenLabsTTS:
    """ElevenLabs Flash v2.5 streaming TTS provider."""

    name = "elevenlabs"

    # PCM 22.05 kHz is what Flash v2.5 emits when we ask for
    # `output_format=pcm_22050`. Other formats are available but
    # this one matches Piper's rate so the pipeline stays simple.
    SAMPLE_RATE = 22050

    def __init__(
        self,
        api_key: str,
        persona_config: dict[str, Any],
        model_id: str = "eleven_flash_v2_5",
    ) -> None:
        self._api_key = api_key
        self._voice_id = persona_config["voiceId"]  # validated by factory
        self._stability = float(persona_config.get("stability", 0.5))
        self._style = float(persona_config.get("styleExaggeration", 0.0))
        self._model_id = model_id
        self._ws_close: Optional[asyncio.Task[None]] = None

    def output_sample_rate(self) -> int:
        return self.SAMPLE_RATE

    async def synthesize(
        self,
        text: str,
        *,
        voice_override: Optional[str] = None,
    ) -> AsyncIterator[TTSAudioChunk]:
        try:
            import websockets  # lazy
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "websockets package not installed; needed for elevenlabs TTS"
            ) from exc

        voice_id = voice_override or self._voice_id
        url = (
            "wss://api.elevenlabs.io/v1/text-to-speech/"
            f"{voice_id}/stream-input?model_id={self._model_id}"
            "&output_format=pcm_22050"
        )

        ws = await _ws_connect(websockets, url, self._api_key)
        try:
            # Init message — one-shot per connection.
            await ws.send(json.dumps({
                "text": " ",
                "voice_settings": {
                    "stability": self._stability,
                    "style": self._style,
                    "similarity_boost": 0.75,
                },
                "xi_api_key": self._api_key,
            }))
            await ws.send(json.dumps({"text": text}))
            # End-of-stream marker — empty text tells the server we're
            # done sending text and to flush the remaining audio.
            await ws.send(json.dumps({"text": ""}))

            last_audio: Optional[bytes] = None
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (TypeError, ValueError):
                    continue

                audio_b64 = msg.get("audio")
                if audio_b64:
                    chunk = base64.b64decode(audio_b64)
                    if last_audio is not None:
                        yield TTSAudioChunk(
                            audio=last_audio,
                            sample_rate=self.SAMPLE_RATE,
                            is_final=False,
                        )
                    last_audio = chunk

                if msg.get("isFinal"):
                    break

            if last_audio is not None:
                yield TTSAudioChunk(
                    audio=last_audio,
                    sample_rate=self.SAMPLE_RATE,
                    is_final=True,
                )
        finally:
            await ws.close()

    async def aclose(self) -> None:
        # The websocket context manager handles teardown; nothing
        # persistent to close.
        return None
