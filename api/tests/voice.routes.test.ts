import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

const SLUG = 'behavioral-interview-brenda';
const INTERNAL_KEY = 'test-internal-voice-key';

async function createSession(h: TestHarness, authHeader: Record<string, string>) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { simulation_slug: SLUG },
    headers: authHeader,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string };
}

describe('voice mode — kill switch', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({ voice: { enabled: false } });
  });
  afterEach(async () => {
    await h.close();
  });

  it('returns 503 voice_disabled on /voice/start when VOICE_ENABLED=false', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'voice_disabled' });
  });

  it('returns 503 on /internal/state-for-voice when disabled', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/state-for-voice`,
      headers: { 'x-internal-key': 'whatever' },
    });
    expect(res.statusCode).toBe(503);
  });
});

describe('voice mode — token mint + ownership', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({
      voice: {
        enabled: true,
        livekitApiKey: 'unit-key',
        livekitApiSecret: 'unit-secret-min-32-chars-unit-secret-min-32-chars',
        livekitUrl: 'wss://livekit.test:443',
        dailyMinutesPerUser: 20,
        internalKey: INTERNAL_KEY,
      },
    });
  });
  afterEach(async () => {
    await h.close();
  });

  it('mints a LiveKit token and echoes the SFU URL', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.livekit_url).toBe('wss://livekit.test:443');
    // Room name is unique per call (stable `sess_<id>` prefix + nonce)
    // so an immediate end+restart never collides on the room and always
    // gets a fresh agent dispatch.
    expect(body.room).toMatch(new RegExp(`^sess_${session.id}__[0-9a-f]{8}$`));
    expect(body.quota_remaining_seconds).toBe(20 * 60);
  });

  it('rejects start for a session the caller does not own', async () => {
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');
    const session = await createSession(h, alice.authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: bob.authHeader,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown session', async () => {
    const { authHeader } = await registerAndAuth(h.app);

    const res = await h.app.inject({
      method: 'POST',
      url: '/sessions/00000000-0000-0000-0000-000000000000/voice/start',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('voice mode — daily quota', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({
      voice: {
        enabled: true,
        livekitApiKey: 'unit-key',
        livekitApiSecret: 'unit-secret-min-32-chars-unit-secret-min-32-chars',
        // 1 minute total per user per day so the test can exhaust it
        // with a single 60-second debit instead of looping.
        dailyMinutesPerUser: 1,
        internalKey: INTERNAL_KEY,
      },
    });
  });
  afterEach(async () => {
    await h.close();
  });

  it('user /voice/end marks ended but does NOT debit (worker is authoritative)', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });

    const end = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/end`,
      headers: authHeader,
      payload: { seconds_used: 30 },
    });
    expect(end.statusCode).toBe(200);
    // No debit from the client path — the full cap remains.
    expect(end.json()).toMatchObject({
      seconds_recorded: 0,
      quota_remaining_seconds: 60,
    });
  });

  it('internal /voice/end debits the quota authoritatively', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });

    const end = await h.app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/voice/end`,
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { seconds_used: 30 },
    });
    expect(end.statusCode, end.body).toBe(200);
    expect(end.json()).toMatchObject({
      seconds_recorded: 30,
      quota_remaining_seconds: 30, // 60 cap - 30 used
    });
  });

  it('internal /voice/end requires the X-Internal-Key header', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const noHeader = await h.app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/voice/end`,
      payload: { seconds_used: 10 },
    });
    expect(noHeader.statusCode).toBe(401);
  });

  it('refuses /voice/start once the daily cap is exhausted', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    // Start, then debit 60s authoritatively via the worker route to
    // exhaust the 1-minute cap.
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    const end = await h.app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/voice/end`,
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { seconds_used: 60 },
    });
    expect(end.statusCode).toBe(200);

    // Second start should now 429 voice_quota_exhausted.
    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'voice_quota_exhausted' });
  });

  it('persists voice_analysis into state_snapshot.analysis.voice (internal end)', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });

    const end = await h.app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/voice/end`,
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: {
        seconds_used: 12,
        voice_analysis: {
          user_avg_wpm: 142.5,
          user_filler_count: 3,
          longest_silence_sec: 4.2,
          turns: [
            { role: 'human', transcript_preview: 'hi', duration_sec: 1.0 },
          ],
        },
      },
    });
    expect(end.statusCode, end.body).toBe(200);

    // Pull the snapshot back via the internal endpoint and confirm
    // the analytics landed under analysis.voice.
    const fetched = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/state-for-voice`,
      headers: { 'x-internal-key': INTERNAL_KEY },
    });
    expect(fetched.statusCode).toBe(200);
    const snapshot = fetched.json();
    expect(snapshot.analysis?.voice).toMatchObject({
      user_avg_wpm: 142.5,
      user_filler_count: 3,
      longest_silence_sec: 4.2,
    });
  });

  it('rejects out-of-range seconds_used at the schema boundary', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });

    const end = await h.app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/voice/end`,
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { seconds_used: 999_999 },
    });
    // The schema rejects > 2 hours, so this fails validation.
    expect(end.statusCode).toBe(400);
  });

  it('clamps an in-range-but-implausible debit to the token TTL', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });

    // 7000s passes the 2h schema bound but exceeds the token TTL for a
    // 1-minute cap (60 + 600 = 660s), so the service clamps the debit.
    const end = await h.app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/voice/end`,
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { seconds_used: 7000 },
    });
    expect(end.statusCode, end.body).toBe(200);
    expect(end.json()).toMatchObject({ seconds_recorded: 660 });
  });
});

describe('voice mode — single-active-call guard', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({
      voice: {
        enabled: true,
        livekitApiKey: 'unit-key',
        livekitApiSecret: 'unit-secret-min-32-chars-unit-secret-min-32-chars',
        dailyMinutesPerUser: 60,
        internalKey: INTERNAL_KEY,
      },
    });
  });
  afterEach(async () => {
    await h.close();
  });

  it('refuses a concurrent /voice/start on a different session with 409 voice_call_in_progress', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const sessionA = await createSession(h, authHeader);
    const sessionB = await createSession(h, authHeader);

    const first = await h.app.inject({
      method: 'POST',
      url: `/sessions/${sessionA.id}/voice/start`,
      headers: authHeader,
    });
    expect(first.statusCode, first.body).toBe(200);

    // sessionA's call is still active -> starting a *different* session is
    // the real multi-tab abuse vector and must be blocked.
    const second = await h.app.inject({
      method: 'POST',
      url: `/sessions/${sessionB.id}/voice/start`,
      headers: authHeader,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'voice_call_in_progress' });
  });

  it('allows a duplicate /voice/start on the SAME session (idempotent)', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const first = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    expect(first.statusCode, first.body).toBe(200);

    // Re-starting the same session supersedes its own prior row rather
    // than 409-ing — this is what makes React Strict Mode's double-invoked
    // mount effect / double-clicks / same-tab reconnects safe.
    const second = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    expect(second.statusCode, second.body).toBe(200);
  });

  it('allows a new /voice/start after the previous call is ended', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    // User end clears the active-call marker immediately.
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/end`,
      headers: authHeader,
      payload: { seconds_used: 5 },
    });

    const restart = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    expect(restart.statusCode, restart.body).toBe(200);
  });

  it('does not lock out a new call once the active row is stale', async () => {
    // A 0-second staleness window means no un-ended row is ever
    // considered active, mimicking a worker that crashed long ago.
    const stale = await buildTestApp({
      voice: {
        enabled: true,
        livekitApiKey: 'unit-key',
        livekitApiSecret: 'unit-secret-min-32-chars-unit-secret-min-32-chars',
        dailyMinutesPerUser: 60,
        activeCallStaleSeconds: 0,
        internalKey: INTERNAL_KEY,
      },
    });
    try {
      const { authHeader } = await registerAndAuth(stale.app);
      const sessionA = await createSession(stale, authHeader);
      const sessionB = await createSession(stale, authHeader);

      await stale.app.inject({
        method: 'POST',
        url: `/sessions/${sessionA.id}/voice/start`,
        headers: authHeader,
      });
      // sessionA never ended, but with a 0s staleness window its row is no
      // longer considered active, so a *different* session may start.
      const second = await stale.app.inject({
        method: 'POST',
        url: `/sessions/${sessionB.id}/voice/start`,
        headers: authHeader,
      });
      expect(second.statusCode, second.body).toBe(200);
    } finally {
      await stale.close();
    }
  });
});

describe('voice mode — internal voice-budget', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({
      voice: {
        enabled: true,
        livekitApiKey: 'unit-key',
        livekitApiSecret: 'unit-secret-min-32-chars-unit-secret-min-32-chars',
        dailyMinutesPerUser: 60,
        internalKey: INTERNAL_KEY,
      },
    });
  });
  afterEach(async () => {
    await h.close();
  });

  it('returns remaining + cap seconds for the session owner', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/voice-budget`,
      headers: { 'x-internal-key': INTERNAL_KEY },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      remaining_seconds: 60 * 60,
      cap_seconds: 60 * 60,
    });

    // After an authoritative 10-minute debit the remaining drops.
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    await h.app.inject({
      method: 'POST',
      url: `/internal/sessions/${session.id}/voice/end`,
      headers: { 'x-internal-key': INTERNAL_KEY },
      payload: { seconds_used: 600 },
    });
    const after = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/voice-budget`,
      headers: { 'x-internal-key': INTERNAL_KEY },
    });
    expect(after.json()).toMatchObject({
      remaining_seconds: 60 * 60 - 600,
      cap_seconds: 60 * 60,
    });
  });

  it('requires the X-Internal-Key header', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/voice-budget`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('voice mode — budget with quota disabled', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({
      voice: {
        enabled: true,
        livekitApiKey: 'unit-key',
        livekitApiSecret: 'unit-secret-min-32-chars-unit-secret-min-32-chars',
        dailyMinutesPerUser: 0,
        internalKey: INTERNAL_KEY,
      },
    });
  });
  afterEach(async () => {
    await h.close();
  });

  it('reports null remaining + cap when the quota is disabled', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/voice-budget`,
      headers: { 'x-internal-key': INTERNAL_KEY },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ remaining_seconds: null, cap_seconds: null });
  });
});

describe('voice mode — internal state-for-voice', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({
      voice: {
        enabled: true,
        internalKey: INTERNAL_KEY,
      },
    });
  });
  afterEach(async () => {
    await h.close();
  });

  it('requires the X-Internal-Key header', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const noHeader = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/state-for-voice`,
    });
    expect(noHeader.statusCode).toBe(401);

    const wrong = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/state-for-voice`,
      headers: { 'x-internal-key': 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('returns the stored state snapshot when authorised', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'GET',
      url: `/internal/sessions/${session.id}/state-for-voice`,
      headers: { 'x-internal-key': INTERNAL_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      simulation: { slug: SLUG },
      messages: expect.any(Array),
    });
  });
});

describe('voice mode — token contents', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({
      voice: {
        enabled: true,
        livekitApiKey: 'token-key',
        livekitApiSecret: 'token-secret-min-32-chars-token-secret-min-32-chars',
        internalKey: INTERNAL_KEY,
      },
    });
  });
  afterEach(async () => {
    await h.close();
  });

  it('encodes session_id + bearer_token in the room metadata', async () => {
    const { authHeader, token } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/voice/start`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const livekitToken = res.json().token as string;

    // Decode the JWT body without bringing in jsonwebtoken — we just
    // need to verify the metadata field contains our routing payload.
    const segments = livekitToken.split('.');
    expect(segments.length).toBe(3);
    const payloadSegment = segments[1] ?? '';
    const claims = JSON.parse(
      Buffer.from(payloadSegment, 'base64url').toString('utf-8'),
    );
    expect(claims.metadata).toBeDefined();
    const metadata = JSON.parse(claims.metadata);
    expect(metadata).toMatchObject({
      session_id: session.id,
      bearer_token: token,
    });
  });
});
