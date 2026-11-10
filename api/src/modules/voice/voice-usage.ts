import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/client.js';
import { sessions, users, voiceMinuteUsage } from '../../db/schema.js';
import { forbidden, HttpError, notFound } from '../../plugins/errors.js';
import { voiceCalls } from './voice-usage.schema.js';

type QueryDatabase = Pick<AppDatabase, 'select' | 'insert' | 'update'>;
export interface VoiceUsageConfig {
  now?: () => Date;
  dailyMinutesPerUser: number;
  resolveEntitlements?: (userId: string) => Promise<{ limits: { voiceDailyMinutes: number } }>;
  terminateRoom: (room: string) => Promise<void>;
  activeCallStaleSeconds?: number;
}
export interface VoiceBudget {
  remainingSeconds: number | null;
  capSeconds: number | null;
  usageDate: string;
  resetAt: Date;
}
export interface VoiceCheckpoint extends VoiceBudget { continueCall: boolean }
export const formatUsageDate = (date: Date): string => date.toISOString().slice(0, 10);

/** Split a server-anchored duration into exact integer-second UTC buckets. */
export function splitUsage(start: Date, fromSeconds: number, toSeconds: number) {
  const buckets: { usageDate: string; seconds: number }[] = [];
  let cursor = start.getTime() + fromSeconds * 1000;
  const end = start.getTime() + toSeconds * 1000;
  while (cursor < end) {
    const date = new Date(cursor);
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    const next = Math.min(end, midnight);
    buckets.push({ usageDate: formatUsageDate(date), seconds: (next - cursor) / 1000 });
    cursor = next;
  }
  return buckets;
}

export function createVoiceUsage(db: AppDatabase, config: VoiceUsageConfig) {
  const now = config.now ?? (() => new Date());
  const leaseSeconds = config.activeCallStaleSeconds ?? 60;
  async function capFor(userId: string): Promise<number | null> {
    const minutes = config.resolveEntitlements
      ? (await config.resolveEntitlements(userId)).limits.voiceDailyMinutes
      : config.dailyMinutesPerUser;
    return minutes > 0 ? minutes * 60 : null;
  }
  async function used(query: QueryDatabase, userId: string, usageDate: string) {
    const [row] = await query.select().from(voiceMinuteUsage)
      .where(and(eq(voiceMinuteUsage.userId, userId), eq(voiceMinuteUsage.usageDate, usageDate)));
    return row?.secondsUsed ?? 0;
  }
  async function budget(query: QueryDatabase, userId: string, capSeconds: number | null): Promise<VoiceBudget> {
    const at = now();
    const usageDate = formatUsageDate(at);
    return {
      remainingSeconds: capSeconds === null ? null : Math.max(0, capSeconds - await used(query, userId, usageDate)),
      capSeconds, usageDate,
      resetAt: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1)),
    };
  }
  async function lock(query: QueryDatabase, userId: string) {
    // A durable per-owner lock serializes reservations AND daily usage across API instances.
    await query.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  }
  async function endSessionIfCurrent(query: QueryDatabase, call: typeof voiceCalls.$inferSelect, endedAt: Date) {
    // Identity, rather than timestamp equality (two calls may start in the same millisecond).
    const [newer] = await query.select({ id: voiceCalls.id }).from(voiceCalls)
      .where(and(eq(voiceCalls.sessionId, call.sessionId), isNull(voiceCalls.endedAt)));
    if (newer && newer.id !== call.id) return;
    // Callers hold the owner lock and only transition a previously active call.
    // Closed-call callbacks never reach this path. Random UUID ordering cannot
    // identify the newest call when two reservations share the same timestamp.
    await query.update(sessions).set({ voiceCallEndedAt: endedAt, updatedAt: endedAt }).where(eq(sessions.id, call.sessionId));
  }
  return {
    async getBudget(userId: string) { return budget(db, userId, await capFor(userId)); },
    async reserve(userId: string, sessionId: string) {
      const cap = await capFor(userId);
      return db.transaction(async (tx) => {
        await lock(tx, userId);
        const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId));
        if (!session) throw notFound('Session not found');
        if (session.userId !== userId) throw forbidden('You do not own this session');
        const currentBudget = await budget(tx, userId, cap);
        if (currentBudget.remainingSeconds === 0) throw new HttpError(429, 'Daily voice budget exhausted', 'voice_quota_exhausted', {
          resetAt: currentBudget.resetAt.toISOString(), capSeconds: currentBudget.capSeconds,
        });
        const [active] = await tx.select().from(voiceCalls).where(and(eq(voiceCalls.userId, userId), isNull(voiceCalls.endedAt)));
        const at = new Date(Math.floor(now().getTime() / 1000) * 1000);
        if (active) {
          const stale = at.getTime() - active.lastCheckpointAt.getTime() >= leaseSeconds * 1000;
          if (!stale) {
            if (active.sessionId === sessionId) return { call: active, budget: currentBudget };
            throw new HttpError(409, 'You already have an active voice call', 'voice_call_in_progress');
          }
          // Fail closed: a failed SFU termination keeps the reservation. The old
          // worker also stops after 30s without a confirmed budget.
          await config.terminateRoom(active.room);
          const endedAt = new Date(Math.min(at.getTime(), active.lastCheckpointAt.getTime() + 30000));
          await tx.update(voiceCalls).set({ endedAt }).where(eq(voiceCalls.id, active.id));
          await endSessionIfCurrent(tx, active, endedAt);
        }
        const id = randomUUID();
        const [call] = await tx.insert(voiceCalls).values({
          id, userId, sessionId, room: `sess_${sessionId}__${id.slice(0, 8)}`,
          startedAt: at, lastCheckpointAt: at,
        }).returning();
        if (!call) throw new Error('Voice reservation was not created');
        await tx.update(sessions).set({ voiceCallStartedAt: at, voiceCallEndedAt: null, updatedAt: at }).where(eq(sessions.id, sessionId));
        return { call, budget: currentBudget };
      });
    },
    async close(userId: string, sessionId: string, callId: string) {
      const cap = await capFor(userId);
      return db.transaction(async (tx) => {
        await lock(tx, userId);
        const [call] = await tx.select().from(voiceCalls).where(eq(voiceCalls.id, callId));
        if (!call || call.sessionId !== sessionId) throw notFound('Voice call not found');
        if (call.userId !== userId) throw forbidden('You do not own this call');
        if (!call.endedAt) {
          await config.terminateRoom(call.room);
          const endedAt = now();
          await tx.update(voiceCalls).set({ endedAt }).where(eq(voiceCalls.id, callId));
          await endSessionIfCurrent(tx, call, endedAt);
        }
        return budget(tx, userId, cap);
      });
    },
    async checkpoint(args: { callId: string; sequence: number; cumulativeSeconds: number; ended: boolean }): Promise<VoiceCheckpoint> {
      const [owner] = await db.select({ userId: voiceCalls.userId }).from(voiceCalls).where(eq(voiceCalls.id, args.callId));
      if (!owner) throw notFound('Voice call not found');
      const cap = await capFor(owner.userId);
      return db.transaction(async (tx) => {
        await lock(tx, owner.userId);
        const [call] = await tx.select().from(voiceCalls).where(eq(voiceCalls.id, args.callId));
        if (!call) throw notFound('Voice call not found');
        const at = now();
        const stale = !call.endedAt && at.getTime() - call.lastCheckpointAt.getTime() >= leaseSeconds * 1000;
        const endedAt = call.endedAt ?? (stale ? new Date(call.lastCheckpointAt.getTime() + 30000) : null);
        const elapsed = Math.max(0, Math.floor(((endedAt ?? at).getTime() - call.startedAt.getTime()) / 1000));
        if (!Number.isSafeInteger(args.cumulativeSeconds) || args.cumulativeSeconds < 0 || !Number.isSafeInteger(args.sequence) || args.sequence < 0) {
          throw new HttpError(400, 'Invalid cumulative checkpoint', 'voice_invalid_checkpoint');
        }
        const fresh = args.sequence > call.processedSequence;
        if (fresh && args.cumulativeSeconds > Math.max(0, Math.floor((at.getTime() - call.startedAt.getTime()) / 1000)) + 1) throw new HttpError(400, 'Duration exceeds server-observed call time', 'voice_invalid_duration');
        if (fresh && args.cumulativeSeconds < call.cumulativeSeconds) throw new HttpError(400, 'Cumulative duration cannot decrease', 'voice_invalid_duration');
        let charged = 0;
        if (fresh) {
          const cumulative = Math.min(args.cumulativeSeconds, elapsed);
          for (const part of splitUsage(call.startedAt, call.cumulativeSeconds, cumulative)) {
            const debit = cap === null ? part.seconds : Math.min(part.seconds, Math.max(0, cap - await used(tx, call.userId, part.usageDate)));
            if (debit <= 0) continue;
            await tx.insert(voiceMinuteUsage).values({ userId: call.userId, usageDate: part.usageDate, secondsUsed: debit, updatedAt: at })
              .onConflictDoUpdate({ target: [voiceMinuteUsage.userId, voiceMinuteUsage.usageDate], set: { secondsUsed: sql`${voiceMinuteUsage.secondsUsed} + ${debit}`, updatedAt: at } });
            charged += debit;
          }
          await tx.update(voiceCalls).set({ processedSequence: args.sequence, cumulativeSeconds: cumulative,
            chargedSeconds: call.chargedSeconds + charged, lastCheckpointAt: endedAt ? call.lastCheckpointAt : at,
          }).where(eq(voiceCalls.id, call.id));
        }
        const currentBudget = await budget(tx, call.userId, cap);
        const stop = endedAt ?? ((fresh && args.ended) || currentBudget.remainingSeconds === 0 ? at : null);
        if (stop && !call.endedAt) {
          await tx.update(voiceCalls).set({ endedAt: stop }).where(eq(voiceCalls.id, call.id));
          await endSessionIfCurrent(tx, call, stop);
        }
        return { ...currentBudget, continueCall: !stop };
      });
    },
  };
}
