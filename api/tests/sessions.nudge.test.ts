import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sessions } from '../src/db/schema.js';
import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

const SLUG = 'behavioral-interview-brenda';

async function createSession(h: TestHarness, auth: Record<string, string>) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { simulation_slug: SLUG },
    headers: auth,
  });
  if (res.statusCode !== 201) throw new Error(`createSession ${res.statusCode}: ${res.body}`);
  return res.json();
}

/** Rewind the server-visible last-human-activity clock so guardrail tests
 *  don't have to actually wait. */
async function rewindLastHumanMessage(
  h: TestHarness,
  sessionId: string,
  secondsAgo: number,
): Promise<void> {
  const then = new Date(Date.now() - secondsAgo * 1000);
  await h.db.db
    .update(sessions)
    .set({ lastHumanMessageAt: then, updatedAt: then })
    .where(eq(sessions.id, sessionId));
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/nudge — guardrails
// ---------------------------------------------------------------------------

describe('POST /sessions/:id/nudge', () => {
  let h: TestHarness;

  afterEach(async () => {
    await h?.close();
  });

  it("returns { nudged: false, reason: 'no_human_activity' } right after session create", async () => {
    h = await buildTestApp({ nudge: { minIdleSeconds: 60, maxPerSilence: 2 } });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: {},
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ nudged: false, reason: 'no_human_activity' });
    expect(body.nudge_count).toBe(0);
  });

  it("returns { nudged: false, reason: 'not_enough_idle' } before the idle window elapses", async () => {
    h = await buildTestApp({ nudge: { minIdleSeconds: 60, maxPerSilence: 2 } });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: {},
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ nudged: false, reason: 'not_enough_idle' });
    expect(body.nudge_count).toBe(0);
    // Importantly: no agent call was made.
    expect(h.agent.callLog.some((c) => c.startsWith('proactive:inactivity'))).toBe(false);
  });

  it('fires the nudge once the idle window has elapsed', async () => {
    h = await buildTestApp({ nudge: { minIdleSeconds: 60, maxPerSilence: 2 } });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    await rewindLastHumanMessage(h, session.id, 120);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: {},
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nudged).toBe(true);
    expect(body.session.messages.at(-1)).toMatchObject({
      role: 'ai',
      content: 'proactive:inactivity',
    });
    expect(h.agent.callLog).toContain('proactive:inactivity');
  });

  it('enforces the per-silence budget — max_per_silence=1 means the second call skips', async () => {
    h = await buildTestApp({ nudge: { minIdleSeconds: 60, maxPerSilence: 1 } });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    await rewindLastHumanMessage(h, session.id, 300);

    const first = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: {},
      headers: authHeader,
    });
    expect(first.json().nudged).toBe(true);

    // Still idle, but budget consumed — second call must be skipped without
    // calling the agent again.
    const agentCallsBefore = h.agent.callLog.filter((c) => c === 'proactive:inactivity').length;
    const second = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: {},
      headers: authHeader,
    });
    expect(second.json()).toMatchObject({
      nudged: false,
      reason: 'budget_exhausted',
      nudge_count: 1,
    });
    const agentCallsAfter = h.agent.callLog.filter((c) => c === 'proactive:inactivity').length;
    expect(agentCallsAfter).toBe(agentCallsBefore);
  });

  it('a new human reply resets the idle clock and the nudge budget', async () => {
    h = await buildTestApp({ nudge: { minIdleSeconds: 60, maxPerSilence: 1 } });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    await rewindLastHumanMessage(h, session.id, 300);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: {},
      headers: authHeader,
    }); // fires, consumes budget

    // Human replies → counters should reset.
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: "i'm here" },
      headers: authHeader,
    });

    // Fresh silence again.
    await rewindLastHumanMessage(h, session.id, 300);
    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: {},
      headers: authHeader,
    });
    expect(res.json().nudged).toBe(true);
  });

  it('rejects nudging a session that belongs to a different user (403)', async () => {
    h = await buildTestApp({ nudge: { minIdleSeconds: 0, maxPerSilence: 2 } });
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');
    const session = await createSession(h, alice.authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: {},
      headers: bob.authHeader,
    });
    expect(res.statusCode).toBe(403);
  });

  it('honours a per-request min_idle_seconds override, but only when it is >= the server floor', async () => {
    h = await buildTestApp({ nudge: { minIdleSeconds: 30, maxPerSilence: 2 } });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    await rewindLastHumanMessage(h, session.id, 45);

    // Client tries to force a longer window (60 > 45) → skipped.
    const strict = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: { min_idle_seconds: 60 },
      headers: authHeader,
    });
    expect(strict.json()).toMatchObject({ nudged: false, reason: 'not_enough_idle' });

    // Client tries to weaken the window (10 < 30, server floor wins) → still
    // fires because actual idle (45s) is >= the server floor (30s).
    const loose = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      payload: { min_idle_seconds: 10 },
      headers: authHeader,
    });
    expect(loose.json().nudged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/proactive — followup-only batch
// ---------------------------------------------------------------------------

describe('POST /sessions/:id/proactive (batch, followup-only)', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('fires a followup and does NOT reset the inactivity clock', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });

    const before = await h.db.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    const beforeTs = before[0]!.lastHumanMessageAt!.getTime();

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/proactive`,
      payload: { trigger_type: 'followup' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages.at(-1)).toMatchObject({
      role: 'ai',
      content: 'proactive:followup',
    });

    const after = await h.db.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(after[0]!.lastHumanMessageAt!.getTime()).toBe(beforeTs);
    expect(after[0]!.nudgeCountSinceHuman).toBe(0);
  });

  it('rejects trigger_type: "inactivity" (must use /nudge)', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/proactive`,
      payload: { trigger_type: 'inactivity' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects trigger_type: "start" (only runs at init)', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/proactive`,
      payload: { trigger_type: 'start' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/proactive/stream — SSE followup
// ---------------------------------------------------------------------------

function parseSSE(raw: string): Array<{ event: string; data: unknown }> {
  return raw
    .split(/\n\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      return { event, data: JSON.parse(dataLines.join('\n')) };
    });
}

describe('POST /sessions/:id/proactive/stream', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('streams the followup as SSE and persists on done', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/proactive/stream`,
      payload: { trigger_type: 'followup' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSSE(res.body);
    expect(events.map((e) => e.event)).toEqual(['message', 'done']);
    expect((events[0]!.data as { content: string }).content).toBe('proactive:followup');

    const detail = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    expect(detail.json().messages.at(-1)).toMatchObject({
      role: 'ai',
      content: 'proactive:followup',
    });
  });

  it('rejects inactivity as a stream trigger (must use batch /nudge)', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/proactive/stream`,
      payload: { trigger_type: 'inactivity' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
  });
});
