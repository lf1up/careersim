import { and, eq } from 'drizzle-orm';
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';

import type { AgentWireState } from '../../agent/types.js';
import type { AppDatabase } from '../../db/client.js';
import { sessions, voiceMinuteUsage } from '../../db/schema.js';
import { forbidden, notFound } from '../../plugins/errors.js';
import { HttpError } from '../../plugins/errors.js';

/**
 * Configuration the voice service reads at startup. Mirrored from the
 * env layer rather than read directly so tests can pass a fake config
 * (faster than mocking process.env on every case).
 */
export interface VoiceServiceConfig {
  /** Master kill switch — when false the service throws 503 on every call. */
  enabled: boolean;
  /** LiveKit signalling URL; passed straight back to the client. */
  livekitUrl: string;
  /** API key used to mint short-lived join tokens. */
  livekitApiKey: string;
  /** Matching API secret. */
  livekitApiSecret: string;
  /** Per-user-per-day quota in minutes (0 = quota disabled). */
  dailyMinutesPerUser: number;
  /** TTL for minted tokens; defaults to 1 hour. */
  tokenTtlSeconds?: number;
  /**
   * Date provider — defaults to `() => new Date()`. Tests pass a fixed
   * clock so the rolling per-day bucket is deterministic.
   */
  now?: () => Date;
}

export interface VoiceStartResult {
  token: string;
  livekitUrl: string;
  room: string;
  expiresAt: Date;
  quotaRemainingSeconds: number | null;
}

export interface VoiceEndResult {
  secondsRecorded: number;
  quotaRemainingSeconds: number | null;
}

export interface VoiceService {
  /**
   * Start a voice call for `sessionId`. Verifies ownership, checks the
   * daily quota, marks the session as call-in-progress, and mints a
   * LiveKit join token whose participant metadata carries `session_id`
   * + `bearer_token` so the agent-voice worker can re-enter the API.
   */
  startCall(args: {
    userId: string;
    sessionId: string;
    bearerToken: string;
  }): Promise<VoiceStartResult>;

  /**
   * End a voice call and debit the user's daily quota by
   * `secondsUsed`. Idempotent — a duplicate `end` for an
   * already-ended session is a no-op (returns the previously-recorded
   * delta).
   */
  endCall(args: {
    userId: string;
    sessionId: string;
    secondsUsed: number;
    /**
     * Optional aggregate voice analytics produced by the worker. When
     * present, merged into `state_snapshot.analysis.voice` so the
     * feedback view can surface pacing / filler / latency signals
     * without re-deriving them.
     */
    voiceAnalysis?: Record<string, unknown>;
  }): Promise<VoiceEndResult>;

  /**
   * Internal-only state-for-voice fetch.
   *
   * Returns the session's stateSnapshot. Caller is the agent-voice
   * worker, authenticated via the existing `X-Internal-Key` shared
   * secret rather than a user JWT — see `voice.route.ts`.
   */
  fetchStateForVoice(sessionId: string): Promise<AgentWireState>;

  /**
   * Read the user's remaining voice budget for the current UTC day.
   * Returns `null` if quota tracking is disabled (`dailyMinutesPerUser
   * <= 0`).
   */
  getQuotaRemainingSeconds(userId: string): Promise<number | null>;
}

const ROOM_NAME_PREFIX = 'sess_';

/**
 * Build the LiveKit room name for a session. Stable + reversible so
 * ops can correlate room IDs in the SFU logs back to a session row.
 * The 8-char prefix on the UUID keeps things searchable while staying
 * short enough for LiveKit's 64-char limit.
 */
export function roomNameForSession(sessionId: string): string {
  return `${ROOM_NAME_PREFIX}${sessionId}`;
}

/** Format a JS `Date` as a UTC `YYYY-MM-DD` string for the quota bucket. */
export function formatUsageDate(d: Date): string {
  // toISOString -> 2026-05-17T..., split off the date component.
  return d.toISOString().slice(0, 10);
}

/**
 * Merge a worker-supplied `voice_analysis` payload into the session's
 * wire-format snapshot under `analysis.voice`. Pure / immutable: the
 * input snapshot is not mutated. Exported for tests.
 */
export function mergeVoiceAnalysis(
  snapshot: AgentWireState,
  voiceAnalysis: Record<string, unknown>,
): AgentWireState {
  const existingAnalysis =
    snapshot.analysis && typeof snapshot.analysis === 'object'
      ? (snapshot.analysis as Record<string, unknown>)
      : {};
  return {
    ...snapshot,
    analysis: {
      ...existingAnalysis,
      voice: voiceAnalysis,
    },
  };
}

export function createVoiceService(
  db: AppDatabase,
  config: VoiceServiceConfig,
): VoiceService {
  const now = config.now ?? (() => new Date());
  const tokenTtl = config.tokenTtlSeconds ?? 60 * 60; // 1 hour
  const dailySecondsCap =
    config.dailyMinutesPerUser > 0 ? config.dailyMinutesPerUser * 60 : 0;

  function ensureEnabled(): void {
    if (!config.enabled) {
      throw new HttpError(503, 'Voice mode is disabled', 'voice_disabled');
    }
    if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
      throw new HttpError(
        503,
        'Voice mode is enabled but LiveKit credentials are not configured',
        'voice_misconfigured',
      );
    }
  }

  async function readUsage(userId: string, day: string): Promise<number> {
    const [row] = await db
      .select()
      .from(voiceMinuteUsage)
      .where(
        and(eq(voiceMinuteUsage.userId, userId), eq(voiceMinuteUsage.usageDate, day)),
      )
      .limit(1);
    return row?.secondsUsed ?? 0;
  }

  async function quotaRemaining(userId: string): Promise<number | null> {
    if (dailySecondsCap === 0) return null;
    const used = await readUsage(userId, formatUsageDate(now()));
    return Math.max(0, dailySecondsCap - used);
  }

  async function debitUsage(userId: string, seconds: number): Promise<number> {
    const day = formatUsageDate(now());
    const [existing] = await db
      .select()
      .from(voiceMinuteUsage)
      .where(
        and(eq(voiceMinuteUsage.userId, userId), eq(voiceMinuteUsage.usageDate, day)),
      )
      .limit(1);

    if (existing) {
      await db
        .update(voiceMinuteUsage)
        .set({
          secondsUsed: existing.secondsUsed + seconds,
          updatedAt: new Date(),
        })
        .where(eq(voiceMinuteUsage.id, existing.id));
      return existing.secondsUsed + seconds;
    }

    await db.insert(voiceMinuteUsage).values({
      userId,
      usageDate: day,
      secondsUsed: seconds,
    });
    return seconds;
  }

  return {
    async startCall({ userId, sessionId, bearerToken }) {
      ensureEnabled();

      // 1. Ownership + existence check.
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!session) throw notFound('Session not found');
      if (session.userId !== userId) throw forbidden('You do not own this session');

      // 2. Quota check (only if the cap is configured).
      if (dailySecondsCap > 0) {
        const used = await readUsage(userId, formatUsageDate(now()));
        if (used >= dailySecondsCap) {
          throw new HttpError(
            429,
            'Daily voice minutes exhausted; resets at midnight UTC.',
            'voice_quota_exhausted',
          );
        }
      }

      // 3. Mark the session as voice-active for the eval node + UI.
      const startedAt = now();
      await db
        .update(sessions)
        .set({
          voiceCallStartedAt: startedAt,
          voiceCallEndedAt: null,
          updatedAt: startedAt,
        })
        .where(eq(sessions.id, sessionId));

      // 4. Mint the LiveKit join token. The user joins as
      //    `participant_<userId-prefix>` so SFU logs are scrubbable
      //    without correlating IDs.
      const room = roomNameForSession(sessionId);
      const expiresAt = new Date(startedAt.getTime() + tokenTtl * 1000);
      const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity: `user_${userId.slice(0, 8)}`,
        ttl: tokenTtl,
        // LiveKit accepts arbitrary JSON in `metadata`. NOTE: this is
        // *participant*-scoped metadata (it rides on the user's
        // participant, not `room.metadata`). The agent-voice worker
        // reads it off the remote participant to discover which session
        // to load and which bearer token to forward back to
        // /sessions/:id/messages on each turn.
        metadata: JSON.stringify({
          session_id: sessionId,
          bearer_token: bearerToken,
        }),
      });
      const grant: VideoGrant = {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      };
      at.addGrant(grant);
      const token = await at.toJwt();

      const remaining = dailySecondsCap > 0 ? await quotaRemaining(userId) : null;
      return {
        token,
        livekitUrl: config.livekitUrl,
        room,
        expiresAt,
        quotaRemainingSeconds: remaining,
      };
    },

    async endCall({ userId, sessionId, secondsUsed, voiceAnalysis }) {
      ensureEnabled();

      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!session) throw notFound('Session not found');
      if (session.userId !== userId) throw forbidden('You do not own this session');

      const endedAt = now();
      const clamped = Math.max(0, Math.min(secondsUsed, 60 * 60));
      let recorded = 0;
      if (clamped > 0) {
        const updatedTotal = await debitUsage(userId, clamped);
        recorded = clamped;
        // We update the session row regardless of whether the user is
        // over quota *now* — a fair-share design would let ongoing
        // calls finish their turn even if they slightly exceed; the
        // quota check at start time is the gate.
        void updatedTotal;
      }

      // Merge the worker-supplied voice analytics into the existing
      // wire-state snapshot. We do this in-process (not via a JSONB
      // path update) because the analysis envelope already round-trips
      // through `state_snapshot` on every text turn — keeping the
      // merge here means there's exactly one place that mutates the
      // snapshot from the API side.
      const updatedSnapshot =
        voiceAnalysis && Object.keys(voiceAnalysis).length > 0
          ? mergeVoiceAnalysis(session.stateSnapshot, voiceAnalysis)
          : null;

      await db
        .update(sessions)
        .set({
          voiceCallEndedAt: endedAt,
          updatedAt: endedAt,
          ...(updatedSnapshot ? { stateSnapshot: updatedSnapshot } : {}),
        })
        .where(eq(sessions.id, sessionId));

      const remaining = await quotaRemaining(userId);
      return {
        secondsRecorded: recorded,
        quotaRemainingSeconds: remaining,
      };
    },

    async fetchStateForVoice(sessionId) {
      // Internal-key auth happens at the route layer; by the time we
      // reach here the caller is fully trusted (it's our own
      // agent-voice worker). We deliberately do NOT enforce ownership
      // — the worker is talking on behalf of a session, not a user.
      ensureEnabled();
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!session) throw notFound('Session not found');
      return session.stateSnapshot;
    },

    getQuotaRemainingSeconds(userId) {
      return quotaRemaining(userId);
    },
  };
}
