import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerAndAuth, type TestHarness } from './helpers/build-test-app.js';

const key = 'test-voice-internal-key';
const internal = { 'x-internal-key': key };
const slug = 'behavioral-interview-brenda';

describe('voice routes with call identity and cumulative checkpoints', () => {
  let h: TestHarness;
  let at: Date;
  let headers: Record<string, string>;
  let sessionId: string;
  beforeEach(async () => {
    at = new Date('2026-11-10T12:00:00Z');
    h = await buildTestApp({ voice: { enabled: true, dailyMinutesPerUser: 1, internalKey: key,
      now: () => at, terminateRoom: async () => {} } });
    ({ authHeader: headers } = await registerAndAuth(h.app));
    const response = await h.app.inject({ method: 'POST', url: '/v1/sessions', headers, payload: { simulation_slug: slug } });
    expect(response.statusCode, response.body).toBe(201);
    sessionId = response.json().id;
  });
  afterEach(async () => { await h.close(); });
  async function start() {
    return h.app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/voice/start`, headers });
  }
  async function checkpoint(callId: string, sequence = 1, seconds = 15, extra = {}) {
    return h.app.inject({ method: 'POST', url: `/v1/internal/voice/calls/${callId}/checkpoint`, headers: internal,
      payload: { sequence, cumulative_seconds: seconds, ended: false, ...extra } });
  }
  it('mints a ten-minute credential with call identity and reuses the active room on rejoin', async () => {
    const a = (await start()).json(); const b = (await start()).json();
    expect(a.call_id).toMatch(/^[0-9a-f-]{36}$/); expect(b.call_id).toBe(a.call_id); expect(b.room).toBe(a.room);
    expect(Date.parse(a.expires_at) - at.getTime()).toBe(600000);
    const token = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url').toString());
    expect(token.exp - token.nbf).toBe(600);
    expect(JSON.parse(token.metadata)).toEqual({ session_id: sessionId, call_id: a.call_id });
  });
  it('requires ownership to start and end the exact call', async () => {
    const call = (await start()).json(); const bob = await registerAndAuth(h.app, 'bob@voice.test');
    expect((await h.app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/voice/start`, headers: bob.authHeader })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/voice/end`, headers: bob.authHeader, payload: { call_id: call.call_id } })).statusCode).toBe(403);
  });
  it('requires internal authentication and rejects invalid checkpoint data', async () => {
    const call = (await start()).json();
    expect((await h.app.inject({ method: 'POST', url: `/v1/internal/voice/calls/${call.call_id}/checkpoint`, payload: { sequence: 1, cumulative_seconds: 0, ended: false } })).statusCode).toBe(401);
    expect((await checkpoint(call.call_id, -1, 0)).statusCode).toBe(400);
    expect((await checkpoint(call.call_id, 1, -1)).statusCode).toBe(400);
    expect((await checkpoint(call.call_id, 1, 999999)).statusCode).toBe(400);
  });
  it('protects state, budget, and final-analysis routes with the internal secret', async () => {
    const call = (await start()).json();
    for (const action of ['state-for-voice', 'voice-budget']) {
      const url = `/v1/internal/sessions/${sessionId}/${action}`;
      expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(401);
      const response = await h.app.inject({ method: 'GET', url, headers: internal });
      expect(response.statusCode, response.body).toBe(200);
      if (action === 'voice-budget') expect(response.json()).toMatchObject({ cap_seconds: 60, remaining_seconds: 60, usage_date: '2026-11-10' });
    }
    expect((await h.app.inject({ method: 'POST', url: `/v1/internal/sessions/${sessionId}/voice/end`, payload: { call_id: call.call_id } })).statusCode).toBe(401);
  });
  it('rejects unknown sessions and hangups without call identity', async () => {
    expect((await h.app.inject({ method: 'POST', url: '/v1/sessions/11111111-1111-4111-8111-111111111111/voice/start', headers })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/voice/end`, headers, payload: { seconds_used: 15 } })).statusCode).toBe(400);
  });
  it('deduplicates duration, enforces cap, and returns UTC reset information', async () => {
    const call = (await start()).json();
    for (let sequence = 1; sequence <= 3; sequence++) {
      at = new Date(at.getTime() + 15000);
      expect((await checkpoint(call.call_id, sequence, sequence * 15)).statusCode).toBe(200);
    }
    at = new Date(at.getTime() + 15000);
    const first = await checkpoint(call.call_id, 4, 60);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ remaining_seconds: 0, cap_seconds: 60, continue_call: false, usage_date: '2026-11-10', reset_at: '2026-11-11T00:00:00.000Z' });
    expect((await checkpoint(call.call_id, 4, 60)).json()).toEqual(first.json());
    const denied = await start(); expect(denied.statusCode, denied.body).toBe(429);
  });
  it('user hangup does not debit and old callbacks do not mutate the replacement', async () => {
    const call = (await start()).json(); at = new Date(at.getTime() + 15000);
    const end = await h.app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/voice/end`, headers, payload: { call_id: call.call_id } });
    expect(end.json()).toMatchObject({ seconds_recorded: 0, quota_remaining_seconds: 60 });
    const current = (await start()).json();
    expect((await checkpoint(call.call_id, 1, 15, { ended: true })).json().continue_call).toBe(false);
    await h.app.inject({ method: 'POST', url: `/v1/internal/sessions/${sessionId}/voice/end`, headers: internal,
      payload: { call_id: call.call_id, voice_analysis: { user_avg_wpm: 1 } } });
    expect((await start()).json().call_id).toBe(current.call_id);
  });
  it('persists final analysis without a second duration debit', async () => {
    const call = (await start()).json(); at = new Date(at.getTime() + 15000);
    await checkpoint(call.call_id, 1, 15, { ended: true });
    const payload = { call_id: call.call_id, voice_analysis: { user_avg_wpm: 140, turns: [{ transcript: 'saved' }] } };
    for (let i = 0; i < 2; i++) {
      const response = await h.app.inject({ method: 'POST', url: `/v1/internal/sessions/${sessionId}/voice/end`, headers: internal, payload });
      expect(response.json()).toMatchObject({ seconds_recorded: 0, quota_remaining_seconds: 45 });
    }
    const state = await h.app.inject({ method: 'GET', url: `/v1/internal/sessions/${sessionId}/state-for-voice`, headers: internal });
    expect(state.json().analysis.voice).toMatchObject(payload.voice_analysis);
  });
});

describe('voice kill switch', () => {
  it('rejects public and internal work while disabled', async () => {
    const h = await buildTestApp({ voice: { enabled: false } });
    try {
      const { authHeader } = await registerAndAuth(h.app);
      expect((await h.app.inject({ method: 'POST', url: '/v1/sessions/11111111-1111-4111-8111-111111111111/voice/start', headers: authHeader })).statusCode).toBe(503);
      expect((await h.app.inject({ method: 'GET', url: '/v1/internal/sessions/11111111-1111-4111-8111-111111111111/state-for-voice' })).statusCode).toBe(503);
    } finally { await h.close(); }
  });
});
