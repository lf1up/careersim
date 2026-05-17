"""Read-only helpers around the per-persona ``voice`` config.

Pure functions (no I/O, no globals) so the API service and the agent
worker can both share the eligibility / provider-resolution logic
without dragging the audio runtime into hot paths like JWT minting.

The schema is documented in :class:`VoiceConfig` /
:class:`VoiceProviderConfig` in :mod:`..services.data_loader`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Optional


def persona_supports_voice(persona: dict[str, Any]) -> bool:
    """Return ``True`` if the persona declared a usable ``voice`` block.

    A block is "usable" when it exists *and* has at least one entry
    under ``providers``. Personas without a voice block — or with an
    empty providers dict — are silently treated as voice-ineligible
    so the rest of the codebase can fall back to text-only without
    branching.
    """
    voice = persona.get("voice") if isinstance(persona, dict) else None
    if not isinstance(voice, dict):
        return False
    providers = voice.get("providers")
    if not isinstance(providers, dict) or not providers:
        return False
    return True


def resolve_active_tts_provider(
    persona: dict[str, Any],
    *,
    global_default: str,
) -> str:
    """Resolve the TTS provider name for a session.

    Resolution order (highest priority first):

    1. ``persona.voice.providerOverride`` — lets a single persona pin
       a provider regardless of the global default. Useful when, e.g.,
       Vikram's salesy delivery benefits from ElevenLabs even if the
       rest of the cast is on Piper.
    2. ``global_default`` (typically ``settings.voice_tts_provider``).

    The returned name is *not* validated against the persona's
    ``providers`` dict — that's the factory's job in
    :func:`careersim_agent.voice.providers.get_tts_provider`, which
    gives a clearer error pointing at the missing voice ID.
    """
    voice = persona.get("voice") if isinstance(persona, dict) else None
    if isinstance(voice, dict):
        override = voice.get("providerOverride")
        if isinstance(override, str) and override:
            return override
    return global_default


def resolve_voice_provider_config(
    persona: dict[str, Any],
    provider_name: str,
) -> Optional[dict[str, Any]]:
    """Return the persona's per-provider config block, or ``None``.

    Callers should treat ``None`` as "this persona has no entry for
    that provider" and either fall back to a provider default voice
    or refuse the session — provider-specific (Piper happily uses
    its env-default voice; ElevenLabs hard-requires a ``voiceId``).
    """
    voice = persona.get("voice") if isinstance(persona, dict) else None
    if not isinstance(voice, dict):
        return None
    providers = voice.get("providers")
    if not isinstance(providers, dict):
        return None
    cfg = providers.get(provider_name)
    if isinstance(cfg, dict):
        return dict(cfg)
    return None


def get_speaking_rate_wpm(persona: dict[str, Any], default: int = 135) -> int:
    """Return the persona's voice speaking rate in WPM with a fallback.

    Falls back through ``voice.speakingRateWpm`` ->
    ``conversationStyle.typingSpeedWpm * 0.9`` -> ``default``.
    The 0.9 multiplier mirrors the mapping rule documented in
    PERSONAS.md / the voice plan: spoken pace is typically slightly
    slower than text typing pace.
    """
    voice = persona.get("voice") if isinstance(persona, dict) else None
    if isinstance(voice, dict):
        wpm = voice.get("speakingRateWpm")
        if isinstance(wpm, int) and wpm > 0:
            return wpm

    cs = persona.get("conversationStyle") if isinstance(persona, dict) else None
    if isinstance(cs, dict):
        typing = cs.get("typingSpeedWpm")
        if isinstance(typing, int) and typing > 0:
            return max(1, round(typing * 0.9))

    return default


def get_silence_threshold_ms(
    persona: dict[str, Any],
    default: int = 6000,
) -> int:
    """Return how long the persona will tolerate user silence.

    Falls back to ``conversationStyle.inactivityNudgeDelaySec.min *
    1000`` (since the existing chat-side nudge cadence is the natural
    proxy for "how patient is this persona"), then to ``default``.
    """
    voice = persona.get("voice") if isinstance(persona, dict) else None
    if isinstance(voice, dict):
        ms = voice.get("silenceThresholdMs")
        if isinstance(ms, int) and ms > 0:
            return ms

    cs = persona.get("conversationStyle") if isinstance(persona, dict) else None
    if isinstance(cs, dict):
        nudge = cs.get("inactivityNudgeDelaySec")
        if isinstance(nudge, dict):
            min_sec = nudge.get("min")
            if isinstance(min_sec, int) and min_sec > 0:
                return min_sec * 1000

    return default


def get_barge_in_tolerance_ms(
    persona: dict[str, Any],
    default: int = 400,
) -> int:
    """Return the minimum user-noise duration that counts as a barge-in.

    Higher values (Marcus, ~800 ms) mean the persona tolerates
    throat-clears and short interjections without stopping; lower
    values (Vikram, ~200 ms) make the persona react to the slightest
    user input. Falls back to ``default`` when unset.
    """
    voice = persona.get("voice") if isinstance(persona, dict) else None
    if isinstance(voice, dict):
        ms = voice.get("bargeInToleranceMs")
        if isinstance(ms, int) and ms > 0:
            return ms
    return default


def get_filler_word_frequency(persona: dict[str, Any]) -> str:
    """Return ``"low" | "medium" | "high"`` (default ``"low"``).

    Surfaced into the system prompt so the persona produces realistic
    filler words ("um", "you know", "like") and into TTS prosody
    settings on providers that support them.
    """
    voice = persona.get("voice") if isinstance(persona, dict) else None
    if isinstance(voice, dict):
        freq = voice.get("fillerWordFrequency")
        if isinstance(freq, str) and freq in {"low", "medium", "high"}:
            return freq
    return "low"


# -----------------------------------------------------------------
# Aggregate tuning struct
# -----------------------------------------------------------------


FillerFrequency = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class VoiceTuning:
    """All persona-level voice tunings flattened into one struct.

    Built once at room start (cheap — a few dict reads) and passed
    into the LiveKit ``AgentSession`` wiring so the per-persona
    knobs reach VAD, barge-in detection, and the prompt-augment
    hook without each call site re-reading the persona dict.

    Mapping to LiveKit Agents (current SDK as of plan time):

    * ``silence_threshold_ms`` -> caller-side watchdog that fires
      a per-persona inactivity prompt; not the VAD's ``min_silence``.
    * ``barge_in_tolerance_ms`` -> minimum user voice activity (ms)
      the SDK must observe before it cancels in-flight TTS. Maps to
      ``vad.min_speech_duration_ms`` (silero) on the room input.
    * ``speaking_rate_wpm`` -> piped through to TTS providers that
      accept a rate (Piper uses ``length_scale``; OpenAI ignores).
    * ``filler_word_frequency`` -> consumed by a system-prompt
      decorator (Phase-6 follow-up) that nudges the persona to add
      more or fewer disfluencies.
    """
    speaking_rate_wpm: int
    silence_threshold_ms: int
    barge_in_tolerance_ms: int
    filler_word_frequency: FillerFrequency


def resolve_voice_tuning(persona: dict[str, Any]) -> VoiceTuning:
    """Collapse per-persona voice knobs into a :class:`VoiceTuning`.

    Pure read; defaults documented on the individual resolvers.
    Returned struct is frozen so downstream code can pass it across
    coroutines / threads without worrying about mutation.
    """
    return VoiceTuning(
        speaking_rate_wpm=get_speaking_rate_wpm(persona),
        silence_threshold_ms=get_silence_threshold_ms(persona),
        barge_in_tolerance_ms=get_barge_in_tolerance_ms(persona),
        filler_word_frequency=get_filler_word_frequency(persona),  # type: ignore[arg-type]
    )
