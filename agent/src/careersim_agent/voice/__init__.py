"""Browser-native voice mode for CareerSIM.

Wires a self-hosted LiveKit SFU + a chained STT -> existing LangGraph
turn -> TTS pipeline alongside the existing chat surface. The
``ConversationService`` and the LangGraph engine itself are reused
verbatim; this package adds *only* the audio I/O and persona-driven
voice configuration.

Public entry points (available under their respective submodules, not
re-exported at the package root to keep module load import-light):

- :func:`careersim_agent.voice.persona_voice.persona_supports_voice`
  and :func:`resolve_voice_provider_config` — read-only helpers used by
  the API and worker to decide whether a session is voice-eligible.
- :class:`careersim_agent.voice.providers.STTProvider` /
  :class:`TTSProvider` — runtime-agnostic Protocols implemented by
  every concrete provider under :mod:`careersim_agent.voice.providers`.
- :func:`careersim_agent.voice.providers.get_stt_provider` /
  :func:`get_tts_provider` — env- and persona-aware factory that picks
  the active impls.
- :class:`careersim_agent.voice.pipeline.LangGraphAdapter` — the LLM
  step plugged into the LiveKit ``AgentSession``; reuses
  :func:`ConversationService.invoke_turn`.
- :func:`careersim_agent.voice.worker.run_worker` — process entry point
  used by ``python -m careersim_agent.main --serve voice``.

Everything below is import-light at module load: the heavy LiveKit /
faster-whisper / piper / cloud SDKs are imported lazily inside the
provider implementations so unit tests can run against the Protocols
without those wheels installed.
"""

from .persona_voice import (
    persona_supports_voice,
    resolve_active_tts_provider,
    resolve_voice_provider_config,
)

__all__ = [
    "persona_supports_voice",
    "resolve_active_tts_provider",
    "resolve_voice_provider_config",
]
