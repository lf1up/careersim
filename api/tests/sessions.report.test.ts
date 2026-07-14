import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

const SLUG = 'behavioral-interview-brenda';

describe('GET /sessions/:id/report', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  async function createSession(authHeader: Record<string, string>) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { simulation_slug: SLUG },
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
      url: `/sessions/${sessionId}/messages`,
      payload: { content },
      headers: authHeader,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  async function getReport(authHeader: Record<string, string>, sessionId: string) {
    return h.app.inject({
      method: 'GET',
      url: `/sessions/${sessionId}/report`,
      headers: authHeader,
    });
  }

  it('returns 400 NO_USER_MESSAGES before the user has chatted', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);

    const res = await getReport(authHeader, session.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('NO_USER_MESSAGES');
    // The agent must not have been asked to generate anything.
    expect(h.agent.callLog.filter((c) => c.startsWith('debrief'))).toHaveLength(0);
  });

  it('generates and returns a report once the user has sent a message', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);
    await sendMessage(authHeader, session.id, 'hello there');

    const res = await getReport(authHeader, session.id);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();

    expect(body.session_id).toBe(session.id);
    expect(body.simulation_slug).toBe(SLUG);
    expect(body.cached).toBe(false);
    // opener + human + echo
    expect(body.message_count).toBe(3);
    expect(body.report.overall_score).toBeGreaterThan(0);
    expect(body.report.skills.map((s: { key: string }) => s.key)).toContain('clarity');
    expect(body.report.emotional_tone.overall).toBe('composed');
    expect(body.report.strengths.length).toBeGreaterThan(0);
    // Duration injected API-side from message timestamps.
    expect(typeof body.report.stats.duration_seconds).toBe('number');
  });

  it('serves the cached report while the transcript is unchanged', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);
    await sendMessage(authHeader, session.id, 'hello there');

    const first = await getReport(authHeader, session.id);
    expect(first.json().cached).toBe(false);

    const second = await getReport(authHeader, session.id);
    expect(second.statusCode).toBe(200);
    expect(second.json().cached).toBe(true);
    expect(second.json().report.generated_at).toBe(first.json().report.generated_at);

    // Exactly one agent debrief call across both requests.
    expect(h.agent.callLog.filter((c) => c.startsWith('debrief'))).toHaveLength(1);
  });

  it('regenerates the report after the conversation advances', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);
    await sendMessage(authHeader, session.id, 'hello there');

    const first = await getReport(authHeader, session.id);
    expect(first.json().message_count).toBe(3);

    await sendMessage(authHeader, session.id, 'one more thing');

    const second = await getReport(authHeader, session.id);
    expect(second.statusCode).toBe(200);
    expect(second.json().cached).toBe(false);
    expect(second.json().message_count).toBe(5);
    expect(h.agent.callLog.filter((c) => c.startsWith('debrief'))).toHaveLength(2);
  });

  it('is owner-only', async () => {
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');
    const session = await createSession(alice.authHeader);
    await sendMessage(alice.authHeader, session.id, 'hi');

    const res = await getReport(bob.authHeader, session.id);
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown sessions', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const res = await getReport(authHeader, '00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/sessions/00000000-0000-0000-0000-000000000000/report',
    });
    expect(res.statusCode).toBe(401);
  });

  it('report generation does not bump the session version or updated_at', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);
    await sendMessage(authHeader, session.id, 'hello there');

    const before = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    await getReport(authHeader, session.id);
    const after = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    expect(after.json().updated_at).toBe(before.json().updated_at);

    // A turn straight after report generation must not 409 (version intact).
    const turn = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'still works' },
      headers: authHeader,
    });
    expect(turn.statusCode, turn.body).toBe(200);
  });
});
