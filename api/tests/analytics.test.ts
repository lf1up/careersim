import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sessions } from '../src/db/schema.js';
import type { AgentGoalProgress } from '../src/agent/types.js';
import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

const SLUG = 'behavioral-interview-brenda';
const SLUG_2 = 'tech-cultural-fit';

describe('GET /analytics/overview', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  async function createSession(authHeader: Record<string, string>, slug = SLUG) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { simulation_slug: slug },
      headers: authHeader,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }

  async function sendMessage(
    authHeader: Record<string, string>,
    sessionId: string,
    content: string,
  ) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/messages`,
      payload: { content },
      headers: authHeader,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function getOverview(authHeader: Record<string, string>) {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/analytics/overview',
      headers: authHeader,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  /** Write goal_progress directly into the session's state snapshot. */
  async function setGoalProgress(sessionId: string, progress: AgentGoalProgress[]) {
    const [row] = await h.db.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!row) throw new Error(`session not found: ${sessionId}`);
    await h.db.db
      .update(sessions)
      .set({ stateSnapshot: { ...row.stateSnapshot, goal_progress: progress } })
      .where(eq(sessions.id, sessionId));
  }

  it('requires authentication', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/analytics/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('returns zeroed stats for a fresh user', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const body = await getOverview(authHeader);

    expect(body.totals).toEqual({
      sessions: 0,
      simulations_tried: 0,
      messages: 0,
      user_messages: 0,
      practice_seconds: 0,
      voice_seconds: 0,
    });
    expect(body.goals.completion_rate).toBeNull();
    expect(body.reports.analyzed_sessions).toBe(0);
    expect(body.reports.average_overall).toBeNull();
    expect(body.per_simulation).toEqual([]);
  });

  it('aggregates deterministic totals across sessions', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const a = await createSession(authHeader, SLUG);
    const b = await createSession(authHeader, SLUG_2);
    await sendMessage(authHeader, a.id, 'hello');
    await sendMessage(authHeader, a.id, 'again');
    await sendMessage(authHeader, b.id, 'hi there');

    const body = await getOverview(authHeader);
    expect(body.totals.sessions).toBe(2);
    expect(body.totals.simulations_tried).toBe(2);
    // Session a: opener + 2×(human+ai) = 5; session b: opener + human + ai = 3.
    expect(body.totals.messages).toBe(8);
    expect(body.totals.user_messages).toBe(3);
  });

  it('computes goal totals and completion rate from goal_progress snapshots', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const a = await createSession(authHeader, SLUG);
    const b = await createSession(authHeader, SLUG_2);
    const c = await createSession(authHeader, SLUG);

    // a: fully completed (2/2 required; optional ignored).
    await setGoalProgress(a.id, [
      { goalNumber: 1, status: 'achieved', isOptional: false },
      { goalNumber: 2, status: 'achieved', isOptional: false },
      { goalNumber: 3, status: 'not_started', isOptional: true },
    ]);
    // b: partial (1/2 required).
    await setGoalProgress(b.id, [
      { goalNumber: 1, status: 'achieved', isOptional: false },
      { goalNumber: 2, status: 'in_progress', isOptional: false },
    ]);
    // c: no tracked goals — excluded from the completion denominator.
    await setGoalProgress(c.id, []);

    const body = await getOverview(authHeader);
    expect(body.goals.achieved).toBe(3);
    expect(body.goals.total).toBe(4);
    expect(body.goals.completed_sessions).toBe(1);
    expect(body.goals.completable_sessions).toBe(2);
    expect(body.goals.completion_rate).toBe(0.5);
  });

  it('aggregates skill averages, trend, and tones from cached reports only', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const a = await createSession(authHeader, SLUG);
    const b = await createSession(authHeader, SLUG_2);
    await sendMessage(authHeader, a.id, 'hello');
    await sendMessage(authHeader, b.id, 'hi');

    // Generate a report for `a` only.
    const report = await h.app.inject({
      method: 'GET',
      url: `/v1/sessions/${a.id}/report`,
      headers: authHeader,
    });
    expect(report.statusCode, report.body).toBe(200);

    const body = await getOverview(authHeader);
    expect(body.reports.analyzed_sessions).toBe(1);
    expect(body.reports.total_sessions).toBe(2);
    // FakeAgent's report has overall_score 74.
    expect(body.reports.average_overall).toBe(74);
    const byKey = Object.fromEntries(
      body.reports.skill_averages.map((s: { key: string; average: number }) => [
        s.key,
        s.average,
      ]),
    );
    expect(byKey.clarity).toBe(72);
    expect(byKey.goal_outcome).toBe(85);
    expect(body.reports.trend).toHaveLength(1);
    expect(body.reports.trend[0]).toMatchObject({
      session_id: a.id,
      simulation_slug: SLUG,
      overall_score: 74,
    });
    expect(body.reports.tones).toEqual([{ tone: 'composed', count: 1 }]);
    expect(body.reports.top_strengths).toEqual([{ text: 'Clear structure', count: 1 }]);
  });

  it('builds a per-simulation breakdown', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const a = await createSession(authHeader, SLUG);
    const b = await createSession(authHeader, SLUG);
    await createSession(authHeader, SLUG_2);

    await setGoalProgress(a.id, [
      { goalNumber: 1, status: 'achieved', isOptional: false },
    ]);
    await setGoalProgress(b.id, [
      { goalNumber: 1, status: 'in_progress', isOptional: false },
    ]);

    const body = await getOverview(authHeader);
    expect(body.per_simulation).toHaveLength(2);
    const brenda = body.per_simulation.find(
      (s: { simulation_slug: string }) => s.simulation_slug === SLUG,
    );
    expect(brenda).toMatchObject({
      sessions: 2,
      completed_sessions: 1,
      best_goals_achieved: 1,
      goals_required: 1,
    });
  });

  it("never leaks another user's sessions", async () => {
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');
    const session = await createSession(alice.authHeader);
    await sendMessage(alice.authHeader, session.id, 'hello');

    const body = await getOverview(bob.authHeader);
    expect(body.totals.sessions).toBe(0);
    expect(body.totals.messages).toBe(0);
  });
});
