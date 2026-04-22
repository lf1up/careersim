import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sessions } from '../src/db/schema.js';
import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';
import { FakeAgent } from './helpers/fake-agent.js';

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

/** Rewind the server-visible idle baseline so guardrail tests don't have to
 *  actually wait. Moves BOTH `lastHumanMessageAt` and `lastNudgeAt` (if set)
 *  back by the same amount, because the server baselines idle on
 *  `max(lastHumanMessageAt, lastNudgeAt)` to space successive nudges. */
async function rewindLastHumanMessage(
  h: TestHarness,
  sessionId: string,
  secondsAgo: number,
): Promise<void> {
  const then = new Date(Date.now() - secondsAgo * 1000);
  const [row] = await h.db.db.select().from(sessions).where(eq(sessions.id, sessionId));
  const patch: { lastHumanMessageAt: Date; updatedAt: Date; lastNudgeAt?: Date } = {
    lastHumanMessageAt: then,
    updatedAt: then,
  };
  if (row?.lastNudgeAt) patch.lastNudgeAt = then;
  await h.db.db.update(sessions).set(patch).where(eq(sessions.id, sessionId));
}

// ---------------------------------------------------------------------------
// POST /sessions/:id/nudge — guardrails
// ---------------------------------------------------------------------------

describe('POST /sessions/:id/nudge', () => {
  let h: TestHarness;

  afterEach(async () => {
    await h?.close();
  });

  // FakeAgent's default conversationStyle: delay { min:60, max:60 }, max
  // nudges = 2. These tests read that profile straight through the API.

  it("returns { nudged: false, reason: 'no_human_activity' } right after session create", async () => {
    h = await buildTestApp();
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ nudged: false, reason: 'no_human_activity' });
    expect(body.nudge_count).toBe(0);
  });

  it("returns { nudged: false, reason: 'not_enough_idle' } before the persona's delay elapses", async () => {
    h = await buildTestApp();
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
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ nudged: false, reason: 'not_enough_idle' });
    expect(body.nudge_count).toBe(0);
    // No wasted agent call.
    expect(h.agent.callLog.some((c) => c.startsWith('proactive:inactivity'))).toBe(false);
  });

  it("fires the nudge once the persona's delay has elapsed", async () => {
    h = await buildTestApp();
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    // Default persona delay is 60s; rewind well past it.
    await rewindLastHumanMessage(h, session.id, 120);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
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

  it("enforces the persona's inactivityNudges.max between two human messages", async () => {
    // Tight persona: fires every 30s, only 1 nudge per silence window.
    const agent = new FakeAgent(undefined, undefined, {
      startsConversation: true,
      inactivityNudgeDelaySec: { min: 30, max: 30 },
      inactivityNudges: { min: 0, max: 1 },
    });
    h = await buildTestApp({ agent });
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
      headers: authHeader,
    });
    expect(first.json().nudged).toBe(true);

    // Push both clocks back past the inter-nudge delay so the skip reason
    // is the budget (not the idle check).
    await rewindLastHumanMessage(h, session.id, 300);
    const agentCallsBefore = h.agent.callLog.filter((c) => c === 'proactive:inactivity').length;
    const second = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
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
    const agent = new FakeAgent(undefined, undefined, {
      startsConversation: true,
      inactivityNudgeDelaySec: { min: 30, max: 30 },
      inactivityNudges: { min: 0, max: 1 },
    });
    h = await buildTestApp({ agent });
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
      headers: authHeader,
    }); // fires, consumes the only budget slot

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
      headers: authHeader,
    });
    expect(res.json().nudged).toBe(true);
  });

  it('rejects nudging a session that belongs to a different user (403)', async () => {
    h = await buildTestApp();
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');
    const session = await createSession(h, alice.authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: bob.authHeader,
    });
    expect(res.statusCode).toBe(403);
  });

  it('resets the idle clock after a fired nudge, so the next one needs a fresh wait', async () => {
    // Persona lets us nudge up to 3 times, 30s between them. Without the
    // `lastNudgeAt` baseline, the first fire at 120s idle would leave
    // idle=120s for the next tick → it would immediately chain another fire
    // and burn the budget in one burst.
    const agent = new FakeAgent(undefined, undefined, {
      startsConversation: true,
      inactivityNudgeDelaySec: { min: 30, max: 30 },
      inactivityNudges: { min: 0, max: 3 },
    });
    h = await buildTestApp({ agent });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    await rewindLastHumanMessage(h, session.id, 120);

    const first = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(first.json().nudged).toBe(true);

    // No rewind between calls. The last-human clock still reads ~120s idle
    // but the last-nudge clock is effectively "now" — the server should
    // treat the post-fire instant as the baseline, so we should NOT chain
    // a second nudge on the very next tick.
    const chained = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(chained.json()).toMatchObject({
      nudged: false,
      reason: 'not_enough_idle',
      nudge_count: 1,
    });
  });

  it('picks the delay deterministically inside the persona range, so the same session converges per window', async () => {
    // Range [30, 80]: the deterministic hash picks a value in that span
    // for the current silence window. Whatever it is, rewinding >=80s must
    // always satisfy it, while rewinding <30s must always fail.
    const agent = new FakeAgent(undefined, undefined, {
      startsConversation: true,
      inactivityNudgeDelaySec: { min: 30, max: 80 },
      inactivityNudges: { min: 0, max: 2 },
    });
    h = await buildTestApp({ agent });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });

    await rewindLastHumanMessage(h, session.id, 20);
    const tooEarly = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(tooEarly.json()).toMatchObject({ nudged: false, reason: 'not_enough_idle' });

    await rewindLastHumanMessage(h, session.id, 90);
    const past = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(past.json().nudged).toBe(true);
  });

  it("treats an empty proactive response as { nudged: false, reason: 'agent_silent' } and refunds the budget", async () => {
    // Agent's proactive graph decided not to emit (e.g. guard inside the
    // graph). The API should NOT burn a slot in the persona's nudge budget
    // when the user would see zero new content.
    const agent = new FakeAgent();
    const normalProactive = agent.proactive.bind(agent);
    agent.proactive = async ({ state }) => ({
      state,
      messages: state.messages ?? [],
      goal_progress: state.goal_progress ?? [],
      analysis: {},
    });
    h = await buildTestApp({ agent });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    await rewindLastHumanMessage(h, session.id, 300);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      nudged: false,
      reason: 'agent_silent',
      nudge_count: 0,
    });

    // Budget untouched: a follow-up call with a proper agent should still fire.
    agent.proactive = normalProactive;
    await rewindLastHumanMessage(h, session.id, 600);
    const retry = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(retry.json().nudged).toBe(true);
  });

  it("returns { nudged: false, reason: 'nudges_disabled' } when the persona omits inactivity config", async () => {
    // Persona style declares typing/burstiness but no inactivity fields —
    // the server should treat it as "this persona doesn't want nudges" and
    // short-circuit before touching the idle / budget math.
    const agent = new FakeAgent(undefined, undefined, {
      startsConversation: true,
      typingSpeedWpm: 120,
      burstiness: { min: 1, max: 2 },
    });
    h = await buildTestApp({ agent });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    // Even with a lot of silence the server should still decline — the
    // decision is "no budget", not "not enough idle".
    await rewindLastHumanMessage(h, session.id, 3_600);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      nudged: false,
      reason: 'nudges_disabled',
      nudge_count: 0,
    });
    // And crucially: no agent call, ever.
    expect(h.agent.callLog.some((c) => c === 'proactive:inactivity')).toBe(false);
  });

  it("treats inactivityNudges.max === 0 the same as undeclared", async () => {
    const agent = new FakeAgent(undefined, undefined, {
      startsConversation: true,
      inactivityNudgeDelaySec: { min: 30, max: 30 },
      inactivityNudges: { min: 0, max: 0 },
    });
    h = await buildTestApp({ agent });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    await rewindLastHumanMessage(h, session.id, 600);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/nudge`,
      headers: authHeader,
    });
    expect(res.json()).toMatchObject({ nudged: false, reason: 'nudges_disabled' });
  });

  it('surfaces the persona conversationStyle on GET /sessions/:id as session_config', async () => {
    const agent = new FakeAgent(undefined, undefined, {
      startsConversation: true,
      typingSpeedWpm: 140,
      inactivityNudgeDelaySec: { min: 20, max: 80 },
      inactivityNudges: { min: 2, max: 3 },
      burstiness: { min: 1, max: 3 },
    });
    h = await buildTestApp({ agent });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().session_config).toEqual({
      starts_conversation: true,
      typing_speed_wpm: 140,
      inactivity_nudge_delay_sec: { min: 20, max: 80 },
      max_inactivity_nudges: 3,
      burstiness: { min: 1, max: 3 },
    });
  });

  it('surfaces "sometimes" startsConversation verbatim so the UI can badge it', async () => {
    // When a persona uses the tri-state `"sometimes"` (~50% chance of opening),
    // the API must pass that string through unchanged rather than collapsing
    // it to `null` — otherwise the frontend can't distinguish "sometimes"
    // from "field not declared".
    const agent = new FakeAgent(undefined, undefined, {
      startsConversation: 'sometimes',
    });
    h = await buildTestApp({ agent });
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(h, authHeader);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().session_config.starts_conversation).toBe('sometimes');
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
