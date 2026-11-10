import { and, eq, gt, sql } from 'drizzle-orm';
import { AccessToken, RoomServiceClient, type VideoGrant } from 'livekit-server-sdk';

import { isGroupScene, type AgentWireState } from '../../agent/types.js';
import type { AppDatabase } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { voiceCalls } from './voice-usage.schema.js';
import { createVoiceUsage, type VoiceCheckpoint, type VoiceUsageConfig, type VoiceBudget } from './voice-usage.js';
export { formatUsageDate } from './voice-usage.js';
export type { VoiceBudget } from './voice-usage.js';
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
  /** Initial-join credential TTL; independent of the usage allowance. */
  tokenTtlSeconds?: number;
  /** Checkpoints are also the active-call lease; defaults to 60 seconds. */
  activeCallStaleSeconds?: number;
  resolveEntitlements?: VoiceUsageConfig['resolveEntitlements'];
  /** Injectable room control; production defaults to LiveKit RoomService.deleteRoom. */
  terminateRoom?: (room: string) => Promise<void>;
  /**
   * Date provider — defaults to `() => new Date()`. Tests pass a fixed
   * clock so the rolling per-day bucket is deterministic.
   */
  now?: () => Date;
}

export interface VoiceStartResult {
  callId: string;
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
  startCall(args: { userId: string; sessionId: string }): Promise<VoiceStartResult>;
  endCall(args: { userId: string; sessionId: string; callId: string }): Promise<VoiceEndResult>;
  endCallInternal(args: { sessionId: string; callId: string; voiceAnalysis?: Record<string, unknown> }): Promise<VoiceEndResult>;
  getBudgetForSession(sessionId: string): Promise<VoiceBudget>;
  checkpointCall(args: { callId: string; sequence: number; cumulativeSeconds: number; ended: boolean }): Promise<VoiceCheckpoint>;
  fetchStateForVoice(sessionId: string): Promise<AgentWireState>;
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

export function createVoiceService(db: AppDatabase, config: VoiceServiceConfig): VoiceService {
  const now = config.now ?? (() => new Date());
  const tokenTtl = config.tokenTtlSeconds ?? 600;
  const usage = createVoiceUsage(db, {
    ...config,
    terminateRoom: config.terminateRoom ?? (async (room) => {
      const control = new RoomServiceClient(config.livekitUrl.replace(/^ws/, 'http'), config.livekitApiKey, config.livekitApiSecret);
      try { await control.deleteRoom(room); }
      catch (error) {
        // An already empty/deleted room is successfully terminated.
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'not_found') throw error;
      }
    }),
  });
  function ensureEnabled() {
    if (!config.enabled) throw new HttpError(503, 'Voice mode is disabled', 'voice_disabled');
    if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) throw new HttpError(503, 'LiveKit credentials are not configured', 'voice_misconfigured');
  }
  async function sessionFor(sessionId: string) {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (!session) throw notFound('Session not found');
    return session;
  }
  return {
    async startCall({ userId, sessionId }) {
      ensureEnabled();
      const session = await sessionFor(sessionId);
      if (session.userId !== userId) throw forbidden('You do not own this session');
      if (isGroupScene(session.stateSnapshot)) throw new HttpError(400, 'Voice mode is not available for group scenes', 'voice_group_unsupported');
      const { call, budget } = await usage.reserve(userId, sessionId);
      const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity: `user_${userId.slice(0, 8)}`, ttl: tokenTtl,
        metadata: JSON.stringify({ session_id: sessionId, call_id: call.id }),
      });
      const grant: VideoGrant = { room: call.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true };
      at.addGrant(grant);
      return { token: await at.toJwt(), livekitUrl: config.livekitUrl, room: call.room, callId: call.id,
        expiresAt: new Date(now().getTime() + tokenTtl * 1000), quotaRemainingSeconds: budget.remainingSeconds };
    },
    async endCall({ userId, sessionId, callId }) {
      ensureEnabled();
      const budget = await usage.close(userId, sessionId, callId);
      return { secondsRecorded: 0, quotaRemainingSeconds: budget.remainingSeconds };
    },
    async endCallInternal({ sessionId, callId, voiceAnalysis }) {
      ensureEnabled();
      const [call] = await db.select().from(voiceCalls).where(eq(voiceCalls.id, callId));
      if (!call || call.sessionId !== sessionId) throw notFound('Voice call not found');
      const budget = await usage.close(call.userId, sessionId, callId);
      // Final analysis never debits duration. A delayed previous-call callback
      // must not overwrite this session's replacement call or its analysis.
      if (voiceAnalysis && Object.keys(voiceAnalysis).length) {
        await db.transaction(async (tx) => {
          // Match the same owner lock used by reservation and checkpoints.
          await tx.select({ id: users.id }).from(users).where(eq(users.id, call.userId)).for('update');
          const [newer] = await tx.select({ id: voiceCalls.id }).from(voiceCalls).where(and(
            eq(voiceCalls.sessionId, sessionId), gt(voiceCalls.ordinal, call.ordinal),
          )).limit(1);
          if (newer) return;
          for (let attempt = 0; attempt < 3; attempt++) {
            const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId));
            if (!session) throw notFound('Session not found');
            const [updated] = await tx.update(sessions).set({
              stateSnapshot: mergeVoiceAnalysis(session.stateSnapshot, voiceAnalysis), version: sql`${sessions.version} + 1`,
            }).where(and(eq(sessions.id, sessionId), eq(sessions.version, session.version))).returning();
            if (updated) return;
          }
          throw new HttpError(409, 'Voice analysis raced a transcript update; retry', 'voice_analysis_conflict');
        });
      }
      return { secondsRecorded: 0, quotaRemainingSeconds: budget.remainingSeconds };
    },
    async checkpointCall(args) { ensureEnabled(); return usage.checkpoint(args); },
    async getBudgetForSession(sessionId) {
      ensureEnabled();
      const session = await sessionFor(sessionId);
      return usage.getBudget(session.userId);
    },
    async fetchStateForVoice(sessionId) { ensureEnabled(); return (await sessionFor(sessionId)).stateSnapshot; },
    async getQuotaRemainingSeconds(userId) { return (await usage.getBudget(userId)).remainingSeconds; },
  };
}
