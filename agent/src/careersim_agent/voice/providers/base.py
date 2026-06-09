"""Provider Protocols + shared dataclasses for voice mode.

These Protocols are intentionally narrower than LiveKit's ``stt.STT`` /
``tts.TTS`` ABCs: the LiveKit pipeline imports the SDK ABCs and
adapts our providers via thin shims (in :mod:`..pipeline`), but unit
tests and any non-LiveKit caller only depend on the surface defined
here. That keeps unit tests SDK-free and lets us swap LiveKit out
later without rewriting every provider.

Audio frames cross the Protocol boundary as raw 16-bit signed PCM
mono at a provider-declared sample rate. We deliberately avoid
``numpy``/``torch`` types — providers can use whatever they like
internally as long as the Protocol surface stays plain ``bytes``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterable, AsyncIterator, Optional, Protocol, runtime_checkable


def is_openrouter_base_url(base_url: Optional[str]) -> bool:
    """True when an OpenAI-compatible base URL actually targets OpenRouter.

    OpenRouter's audio API isn't byte-for-byte OpenAI-compatible — STT
    wants a JSON + base64 body rather than the SDK's multipart upload
    (which it 400s on), and TTS needs an OpenRouter model slug. The
    OpenAI-compatible providers (:mod:`.whisper_openai`,
    :mod:`.openai_tts`) use this to switch on those quirks when the chat
    ``OPENAI_BASE_URL`` already points at OpenRouter, so there's no
    separate "openrouter" provider to select.
    """
    return "openrouter.ai" in (base_url or "").lower()


class UnsupportedProviderError(RuntimeError):
    """Raised by the factory when a provider is selected but unusable.

    Examples: an env name that doesn't match any concrete impl, or a
    cloud provider whose API key is missing. The voice worker treats
    this as a hard configuration error and refuses to start the
    session, surfacing a 503-equivalent to the API.
    """


@dataclass
class STTResult:
    """One transcription event from an STT provider.

    Mirrors LiveKit's ``stt.SpeechEvent`` so wiring the two together
    inside the pipeline shim is a near-direct field copy.
    """
    text: str
    is_final: bool = False
    confidence: Optional[float] = None
    # Per-word timing if the provider supports it (Deepgram /
    # whisper-with-timestamps do; OpenAI's transcription endpoint
    # currently does not). Each entry is ``(word, start_sec, end_sec)``.
    words: list[tuple[str, float, float]] = field(default_factory=list)


@dataclass
class TTSAudioChunk:
    """One PCM audio chunk emitted by a TTS provider.

    ``audio`` is 16-bit signed little-endian mono PCM. ``sample_rate``
    is declared per-chunk so providers that change rate mid-stream
    (rare; ElevenLabs sometimes does on voice switch) stay well-typed.
    ``is_final=True`` marks the last chunk of a synthesis call so
    consumers can flush.
    """
    audio: bytes
    sample_rate: int
    is_final: bool = False


@runtime_checkable
class STTProvider(Protocol):
    """Streaming speech-to-text provider.

    Implementations consume a stream of mono PCM frames at
    ``input_sample_rate()`` Hz and emit :class:`STTResult` events as
    they arrive. The contract intentionally matches LiveKit's
    streaming STT shape so the pipeline shim is trivial.
    """

    name: str  # provider identity for logs / telemetry

    def input_sample_rate(self) -> int:
        """Sample rate the provider expects for incoming audio."""
        ...

    async def transcribe(
        self,
        audio_frames: AsyncIterable[bytes],
        *,
        language: Optional[str] = None,
    ) -> AsyncIterator[STTResult]:
        """Stream transcription events from a stream of PCM frames.

        Both interim (``is_final=False``) and final
        (``is_final=True``) results are emitted. The pipeline only
        passes finals into the LangGraph turn; interims power live
        captions on the web client.
        """
        ...

    async def aclose(self) -> None:
        """Release any provider-side resources (sockets, models)."""
        ...


@runtime_checkable
class TTSProvider(Protocol):
    """Streaming text-to-speech provider."""

    name: str

    def output_sample_rate(self) -> int:
        """Sample rate of the audio chunks emitted by ``synthesize()``."""
        ...

    async def synthesize(
        self,
        text: str,
        *,
        voice_override: Optional[str] = None,
    ) -> AsyncIterator[TTSAudioChunk]:
        """Stream audio chunks for ``text``.

        The voice ID / model selection is normally set at construction
        time from the persona's per-provider config, but
        ``voice_override`` lets callers swap voices mid-session
        (used by the smoke script when sweeping voices).
        """
        ...

    async def aclose(self) -> None:
        """Cancel any in-flight synthesis and release resources."""
        ...


__all__ = [
    "STTProvider",
    "STTResult",
    "TTSAudioChunk",
    "TTSProvider",
    "UnsupportedProviderError",
    "is_openrouter_base_url",
]
