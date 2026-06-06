import { z } from 'zod';

/**
 * Body shape for `POST /sessions/:id/voice/end`.
 *
 * The web client (or, more realistically, the agent-voice worker) sends
 * the elapsed call seconds so the API can debit the per-user daily
 * voice quota. Clamped to a 1-hour ceiling per call to keep an
 * accidental clock-drift / replay from blowing the bucket in one shot;
 * legitimate calls cap out at ~20 minutes via
 * `VOICE_DAILY_MINUTES_PER_USER` anyway.
 */
export const voiceEndSchema = z.object({
  /**
   * Seconds the call lasted; must be a non-negative integer. Clamped
   * to a 2-hour ceiling here as a coarse anti-replay guard — the
   * service applies a tighter, token-TTL-based clamp before debiting.
   */
  seconds_used: z.coerce.number().int().nonnegative().max(2 * 60 * 60),
  /**
   * Optional aggregate voice analytics produced by the agent-voice
   * worker (pacing, fillers, latency, silences, interrupts). When
   * present the API merges it into `state_snapshot.analysis.voice`
   * so the post-session feedback view can render it without needing
   * to re-derive metrics from raw audio.
   *
   * The shape mirrors `agent.services.eval_service.VoiceSignals`
   * minus a couple of derived booleans; we keep it open-ended
   * (`record(unknown)`) so the worker can extend the contract
   * without forcing a coordinated API release for every new metric.
   */
  voice_analysis: z.record(z.string(), z.unknown()).optional(),
});

export type VoiceEndBody = z.infer<typeof voiceEndSchema>;

/**
 * Response from `POST /sessions/:id/voice/start`.
 *
 * `livekit_url` is echoed back to the client (rather than relying on
 * the build-time `NEXT_PUBLIC_LIVEKIT_URL`) so the API can shift
 * environments — preview, staging, prod — without a frontend rebuild.
 *
 * `room` is the LiveKit room name; clients don't need to act on it
 * beyond logging, but exposing it makes ops debugging easier.
 *
 * `quota_remaining_seconds` is the user's remaining voice budget for
 * the current UTC day after this call's reservation. Returns `null`
 * if quota tracking is disabled.
 */
export const voiceStartResponseSchema = z.object({
  token: z.string(),
  livekit_url: z.string(),
  room: z.string(),
  expires_at: z.string(),
  quota_remaining_seconds: z.number().int().nonnegative().nullable(),
});

export type VoiceStartResponse = z.infer<typeof voiceStartResponseSchema>;

/**
 * Response from `POST /sessions/:id/voice/end`.
 *
 * `seconds_recorded` is the value actually persisted to
 * `voice_minute_usage` — useful when the request was clamped or
 * coalesced server-side.
 */
export const voiceEndResponseSchema = z.object({
  seconds_recorded: z.number().int().nonnegative(),
  quota_remaining_seconds: z.number().int().nonnegative().nullable(),
});

export type VoiceEndResponse = z.infer<typeof voiceEndResponseSchema>;

/**
 * Internal endpoint payload — same wire-state shape the agent already
 * persists as `state_snapshot`. Re-exported as a Zod schema so
 * Fastify produces a valid OpenAPI surface for the internal route.
 */
export const stateForVoiceResponseSchema = z
  .record(z.string(), z.unknown())
  .describe('Frozen wire-format state snapshot; identical to sessions.state_snapshot.');

/**
 * Response from the internal `GET /internal/sessions/:id/voice-budget`
 * route. The agent-voice worker reads this at call start to arm its
 * mid-call cutoff watchdog. Both fields are `null` when quota tracking
 * is disabled (`VOICE_DAILY_MINUTES_PER_USER <= 0`), in which case the
 * worker enforces no cap.
 */
export const voiceBudgetResponseSchema = z.object({
  remaining_seconds: z.number().int().nonnegative().nullable(),
  cap_seconds: z.number().int().nonnegative().nullable(),
});

export type VoiceBudgetResponse = z.infer<typeof voiceBudgetResponseSchema>;
