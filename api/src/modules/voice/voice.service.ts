import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';
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
  /**
   * TTL for minted tokens. Defaults to the daily cap plus a 10-minute
   * buffer (so the join token always outlives the longest possible
   * call and the agent-side watchdog stays the sole call-ender), or
   * 1 hour when the quota is disabled.
   */
  tokenTtlSeconds?: number;
  /**
   * How long (seconds) an un-ended call row is considered "active" for
   * the single-active-call guard. Past this window we assume the
   * worker crashed without reporting end and allow a new call rather
   * than locking the user out. Defaults to `tokenTtlSeconds`; `0`
   * disables the guard (nothing is ever considered active).
   */
  activeCallStaleSeconds?: number;
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

export interface VoiceBudget {
  /** Remaining daily voice seconds; `null` when quota is disabled. */
  remainingSeconds: number | null;
  /** The configured daily cap in seconds; `null` when quota is disabled. */
  capSeconds: number | null;
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
   * User-facing call end. Does NOT debit the quota — that is the
   * agent-voice worker's job via {@link endCallInternal}, which uses a
   * server-side authoritative clock the client can't influence. This
   * only stamps `voiceCallEndedAt` (so the single-active-call guard
   * clears the moment the user hangs up) and echoes the remaining
   * budget back for the UI.
   */
  endCall(args: { userId: string; sessionId: string }): Promise<VoiceEndResult>;

  /**
   * Authoritative call end, invoked only by the agent-voice worker
   * (internal-key authenticated). Debits the session owner's daily
   * quota by the worker-measured `secondsUsed`, merges any aggregate
   * `voiceAnalysis`, and stamps `voiceCallEndedAt`.
   */
  endCallInternal(args: {
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
   * Internal-only budget lookup keyed by session (the worker only
   * knows the session id, not the user). Resolves the owner and
   * returns the remaining daily seconds + configured cap so the
   * worker can arm its mid-call cutoff watchdog.
   */
  getBudgetForSession(sessionId: string): Promise<VoiceBudget>;

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
 * Build the LiveKit room name for a single voice call.
 *
 * The name MUST be unique *per call*, not per session. LiveKit's
 * automatic agent dispatch fires once when a room is first created; if
 * we reused a stable `sess_<id>` name, ending a call and immediately
 * restarting the same session would rejoin the *same* room while the
 * previous call's agent is still tearing down. The SFU then sees the
 * room as already-occupied-by-an-agent and never dispatches a fresh
 * worker — so the new call connects but nothing transcribes the user's
 * mic (the lingering agent has already stopped reading frames). Adding
 * a per-call nonce guarantees every `startCall` creates a brand-new
 * room and therefore always gets its own agent.
 *
 * The `sess_<sessionId>` prefix is preserved so ops can still grep all
 * rooms for a session; the `__<nonce>` suffix disambiguates calls. The
 * worker discovers the session from participant metadata (not the room
 * name), and `endCall` keys off `sessionId`, so the nonce is inert
 * everywhere except LiveKit room identity.
 */
export function roomNameForSession(sessionId: string, nonce?: string): string {
  const base = `${ROOM_NAME_PREFIX}${sessionId}`;
  return nonce ? `${base}__${nonce}` : base;
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
  const dailySecondsCap =
    config.dailyMinutesPerUser > 0 ? config.dailyMinutesPerUser * 60 : 0;
  // Token must outlive the longest possible call. With a configured
  // cap that's `cap + 10 min`; with quota disabled we fall back to 1h.
  const tokenTtl =
    config.tokenTtlSeconds ?? (dailySecondsCap > 0 ? dailySecondsCap + 10 * 60 : 60 * 60);
  const activeCallStaleSeconds = config.activeCallStaleSeconds ?? tokenTtl;
  // Upper bound on a single authoritative debit — guards against a
  // bogus/replayed value blowing the bucket. A real call can't exceed
  // the token TTL, so clamp to that.
  const maxDebitSeconds = tokenTtl;

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
    // Atomic upsert: insert a fresh bucket or, on conflict with the
    // existing (user_id, usage_date) row, increment in-place at the DB
    // level. This keeps concurrent debits from clobbering each other
    // (read-modify-write would lose increments under contention). The
    // updated total is returned in the same statement.
    const [row] = await db
      .insert(voiceMinuteUsage)
      .values({
        userId,
        usageDate: day,
        secondsUsed: seconds,
      })
      .onConflictDoUpdate({
        target: [voiceMinuteUsage.userId, voiceMinuteUsage.usageDate],
        set: {
          secondsUsed: sql`${voiceMinuteUsage.secondsUsed} + ${seconds}`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row?.secondsUsed ?? seconds;
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

      // 2b. Single-active-call guard. Each concurrent call passes the
      //     start-time quota check independently (the debit only lands
      //     when the call ends), so without this a user could open N
      //     tabs and run N simultaneous calls to bypass the daily cap.
      //     We treat a call whose row was started within
      //     `activeCallStaleSeconds` and never ended as "in progress".
      //     The staleness window means a worker that crashed without
      //     reporting end can't lock the user out forever.
      //
      //     The guard deliberately EXCLUDES the session being started:
      //     re-starting the same session supersedes its own prior row
      //     (we overwrite `voiceCallStartedAt` below), so a duplicate
      //     start — e.g. React Strict Mode double-invoking the mount
      //     effect, a double-click, or reconnecting the same tab — is
      //     idempotent rather than a 409. Only an active call on a
      //     *different* session (the real multi-tab abuse vector) blocks.
      const staleCutoff = new Date(now().getTime() - activeCallStaleSeconds * 1000);
      const [activeCall] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, userId),
            ne(sessions.id, sessionId),
            isNotNull(sessions.voiceCallStartedAt),
            isNull(sessions.voiceCallEndedAt),
            gt(sessions.voiceCallStartedAt, staleCutoff),
          ),
        )
        .limit(1);
      if (activeCall) {
        throw new HttpError(
          409,
          'A voice call is already in progress. End it before starting another.',
          'voice_call_in_progress',
        );
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
      // Per-call nonce — see `roomNameForSession`. Without it, an
      // immediate end+restart of the same session collides on the room
      // name and the new call never gets an agent dispatched.
      const room = roomNameForSession(sessionId, randomUUID().slice(0, 8));
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

    async endCall({ userId, sessionId }) {
      ensureEnabled();

      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!session) throw notFound('Session not found');
      if (session.userId !== userId) throw forbidden('You do not own this session');

      // No debit here — the worker is authoritative (see
      // `endCallInternal`). We only stamp the end time so the
      // single-active-call guard clears immediately when the user
      // hangs up, rather than waiting for the worker's `finally`.
      const endedAt = now();
      await db
        .update(sessions)
        .set({ voiceCallEndedAt: endedAt, updatedAt: endedAt })
        .where(eq(sessions.id, sessionId));

      const remaining = await quotaRemaining(userId);
      return { secondsRecorded: 0, quotaRemainingSeconds: remaining };
    },

    async endCallInternal({ sessionId, secondsUsed, voiceAnalysis }) {
      ensureEnabled();

      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!session) throw notFound('Session not found');

      const endedAt = now();
      const clamped = Math.max(0, Math.min(secondsUsed, maxDebitSeconds));
      let recorded = 0;
      if (clamped > 0) {
        // We debit regardless of whether the user is over quota *now* —
        // the mid-call watchdog already cut the call at the budget, so
        // a small overshoot from teardown is expected and fine.
        await debitUsage(session.userId, clamped);
        recorded = clamped;
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

      const remaining = await quotaRemaining(session.userId);
      return {
        secondsRecorded: recorded,
        quotaRemainingSeconds: remaining,
      };
    },

    async getBudgetForSession(sessionId) {
      ensureEnabled();
      const [session] = await db
        .select({ userId: sessions.userId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!session) throw notFound('Session not found');
      if (dailySecondsCap === 0) {
        return { remainingSeconds: null, capSeconds: null };
      }
      const remaining = await quotaRemaining(session.userId);
      return { remainingSeconds: remaining, capSeconds: dailySecondsCap };
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
