import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteClient } from '../src/db/client.js';
import { createVoiceService, type VoiceService } from '../src/modules/voice/voice.service.js';
import { voiceCalls } from '../src/modules/voice/voice-usage.schema.js';
import { sessions, users, voiceMinuteUsage } from '../src/db/schema.js';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';

const owner = '11111111-1111-4111-8111-111111111111';
const sid = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';

describe('durable cumulative voice accounting', () => {
  let handle: ReturnType<typeof createPgliteClient>;
  let service: VoiceService;
  let clock: Date;
  let minutes: number;
  const terminated: string[] = [];
  beforeEach(async () => {
    clock = new Date('2026-11-10T12:00:00Z'); minutes = 720; terminated.length = 0;
    handle = createPgliteClient(new PGlite());
    await migrate(handle.db, { migrationsFolder: 'src/db/migrations' });
    await handle.db.insert(users).values({ id: owner, email: 'voice@test.local' });
    await handle.db.insert(sessions).values([
      { id: sid, userId: owner, simulationSlug: 'test', stateSnapshot: {} },
      { id: other, userId: owner, simulationSlug: 'test', stateSnapshot: {} },
    ]);
    service = createVoiceService(handle.db, {
      enabled: true, livekitUrl: 'ws://localhost:7880', livekitApiKey: 'key', livekitApiSecret: 'secret',
      dailyMinutesPerUser: 7, now: () => clock,
      resolveEntitlements: async () => ({ limits: { voiceDailyMinutes: minutes } }),
      terminateRoom: async (room) => { terminated.push(room); },
    });
  });
  afterEach(async () => { await handle.close(); });
  const advance = (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1000); };
  async function start(sessionId = sid) { return service.startCall({ userId: owner, sessionId }); }

  it('resolves the 720-minute paid cap and a per-user Free override', async () => {
    expect((await service.getBudgetForSession(sid)).capSeconds).toBe(43200);
    minutes = 7;
    expect((await service.getBudgetForSession(sid)).capSeconds).toBe(420);
  });
  it('returns the same room and call identity for a fresh rejoin with a ten-minute token', async () => {
    const a = await start(); const b = await start();
    expect(b.callId).toBe(a.callId); expect(b.room).toBe(a.room);
    expect(a.expiresAt.getTime() - clock.getTime()).toBe(600000);
  });
  it('atomically reserves only one active call across sessions', async () => {
    const results = await Promise.allSettled([start(), start(other)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('deduplicates repeated, lower, and out-of-order cumulative checkpoints', async () => {
    const call = await start(); advance(30);
    const first = await service.checkpointCall({ callId: call.callId, sequence: 2, cumulativeSeconds: 30, ended: false });
    for (const sequence of [2, 1, 0]) {
      const result = await service.checkpointCall({ callId: call.callId, sequence, cumulativeSeconds: 15, ended: false });
      expect(result.remainingSeconds).toBe(first.remainingSeconds);
    }
    const [row] = await handle.db.select().from(voiceCalls);
    expect(row?.chargedSeconds).toBe(30);
  });
  it('ignores contradictory replay flags and accepts a bounded late final checkpoint', async () => {
    const call = await start(); advance(15);
    await service.checkpointCall({ callId: call.callId, sequence: 1, cumulativeSeconds: 15, ended: false });
    expect((await service.checkpointCall({ callId: call.callId, sequence: 1, cumulativeSeconds: 15, ended: true })).continueCall).toBe(true);
    advance(5);
    await service.endCall({ userId: owner, sessionId: sid, callId: call.callId });
    advance(10);
    const final = await service.checkpointCall({ callId: call.callId, sequence: 2, cumulativeSeconds: 30, ended: true });
    expect(final.continueCall).toBe(false);
    expect((await handle.db.select().from(voiceCalls))[0]?.chargedSeconds).toBe(20);
  });
  it('rejects server-impossible duration without consuming usage', async () => {
    const call = await start();
    await expect(service.checkpointCall({ callId: call.callId, sequence: 1, cumulativeSeconds: 99999, ended: false })).rejects.toMatchObject({ statusCode: 400 });
    expect(await handle.db.select().from(voiceMinuteUsage)).toHaveLength(0);
  });
  it('splits checkpoints across midnight UTC', async () => {
    clock = new Date('2026-11-10T23:59:00Z'); const call = await start();
    for (let i = 1; i <= 8; i++) { advance(15); await service.checkpointCall({ callId: call.callId, sequence: i, cumulativeSeconds: i * 15, ended: false }); }
    const rows = await handle.db.select().from(voiceMinuteUsage);
    expect(rows.map((r) => r.secondsUsed).sort()).toEqual([60, 60]);
    const budget = await service.getBudgetForSession(sid);
    expect(budget.usageDate).toBe('2026-11-11'); expect(budget.remainingSeconds).toBe(43140);
  });
  it('refreshes downgraded or revoked paid access using the same daily usage', async () => {
    const call = await start(); advance(30);
    await service.checkpointCall({ callId: call.callId, sequence: 1, cumulativeSeconds: 30, ended: false });
    minutes = 0.5; advance(15);
    const result = await service.checkpointCall({ callId: call.callId, sequence: 2, cumulativeSeconds: 45, ended: false });
    expect(result.remainingSeconds).toBe(0); expect(result.continueCall).toBe(false);
    expect((await handle.db.select().from(voiceMinuteUsage))[0]?.secondsUsed).toBe(30);
  });
  it('old end and final checkpoints cannot end or overwrite a replacement call', async () => {
    const old = await start(); advance(15);
    await service.endCall({ userId: owner, sessionId: sid, callId: old.callId });
    const current = await start();
    await service.checkpointCall({ callId: old.callId, sequence: 1, cumulativeSeconds: 15, ended: true });
    await service.endCallInternal({ sessionId: sid, callId: old.callId, voiceAnalysis: { turns: ['old'] } });
    expect((await start()).callId).toBe(current.callId);
    const [row] = await handle.db.select().from(sessions).where(eq(sessions.id, sid));
    expect(row?.voiceCallEndedAt).toBeNull(); expect(row?.stateSnapshot.analysis).toBeUndefined();
  });
  it('ends the current call even when an older call shares its start timestamp', async () => {
    const old = await start();
    await service.endCall({ userId: owner, sessionId: sid, callId: old.callId });
    await handle.db.update(voiceCalls).set({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }).where(eq(voiceCalls.id, old.callId));
    const current = await start();
    advance(15);
    await service.endCall({ userId: owner, sessionId: sid, callId: current.callId });
    const [row] = await handle.db.select().from(sessions).where(eq(sessions.id, sid));
    expect(row?.voiceCallEndedAt).toEqual(clock);
  });
  it('saves replacement analysis when both calls start in the same second', async () => {
    const old = await start();
    await service.endCall({ userId: owner, sessionId: sid, callId: old.callId });
    const current = await start();
    await service.endCallInternal({ sessionId: sid, callId: current.callId, voiceAnalysis: { turns: ['current'] } });
    await service.endCallInternal({ sessionId: sid, callId: old.callId, voiceAnalysis: { turns: ['old'] } });
    const [row] = await handle.db.select().from(sessions).where(eq(sessions.id, sid));
    expect(row?.stateSnapshot.analysis).toEqual({ voice: { turns: ['current'] } });
  });
  it('terminates stale rooms before replacement and rejects the old worker next checkpoint', async () => {
    const old = await start(); advance(61); const current = await start(other);
    expect(terminated).toContain(old.room); expect(current.callId).not.toBe(old.callId);
    const result = await service.checkpointCall({ callId: old.callId, sequence: 1, cumulativeSeconds: 61, ended: false });
    expect(result.continueCall).toBe(false);
  });
  it('expires a worker lease at exactly sixty seconds without a checkpoint', async () => {
    const call = await start(); advance(60);
    const result = await service.checkpointCall({ callId: call.callId, sequence: 1, cumulativeSeconds: 60, ended: false });
    expect(result.continueCall).toBe(false);
    expect((await handle.db.select().from(voiceCalls))[0]?.chargedSeconds).toBe(30);
  });
  it('keeps the old reservation when stale room termination fails', async () => {
    const call = await start(); advance(60);
    const failing = createVoiceService(handle.db, {
      enabled: true, livekitUrl: 'ws://localhost:7880', livekitApiKey: 'key', livekitApiSecret: 'secret',
      dailyMinutesPerUser: 720, now: () => clock,
      terminateRoom: async () => { throw new Error('SFU unavailable'); },
    });
    await expect(failing.startCall({ userId: owner, sessionId: other })).rejects.toThrow('SFU unavailable');
    const [row] = await handle.db.select().from(voiceCalls);
    expect(row?.id).toBe(call.callId); expect(row?.endedAt).toBeNull();
  });
});
