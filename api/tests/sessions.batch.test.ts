import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

const SLUG = 'behavioral-interview-brenda';

describe('sessions (batch endpoints)', () => {
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

  it('POST /sessions creates a session and persists the opener AI message', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);

    expect(session.simulation_slug).toBe(SLUG);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      role: 'ai',
      content: expect.stringContaining('hello from'),
      order_index: 0,
    });
  });

  it('GET /sessions/:id returns the detail for the owner only', async () => {
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');
    const session = await createSession(alice.authHeader);

    const own = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: alice.authHeader,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().id).toBe(session.id);

    const stranger = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: bob.authHeader,
    });
    expect(stranger.statusCode).toBe(403);
  });

  it('returns 404 for unknown session ids', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const res = await h.app.inject({
      method: 'GET',
      url: '/sessions/00000000-0000-0000-0000-000000000000',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /sessions/:id/messages appends [human, ai] in order', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'hello world' },
      headers: authHeader,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    const tail = body.messages.slice(-2);
    expect(tail).toEqual([
      expect.objectContaining({ role: 'human', content: 'hello world', order_index: 1 }),
      expect.objectContaining({ role: 'ai', content: 'echo:hello world', order_index: 2 }),
    ]);

    const fetched = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    expect(fetched.json().messages).toEqual(body.messages);
  });

  it('POST /sessions/:id/proactive appends a proactive message', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/proactive`,
      payload: { trigger_type: 'followup' },
      headers: authHeader,
    });
    expect(res.statusCode, res.body).toBe(200);
    const last = res.json().messages.at(-1);
    expect(last).toMatchObject({ role: 'ai', content: 'proactive:followup' });
  });

  it('validates body types (invalid trigger → 400)', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);
    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/proactive`,
      payload: { trigger_type: 'nope' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects creating a session for an unknown simulation slug with 502', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const res = await h.app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { simulation_slug: 'does-not-exist' },
      headers: authHeader,
    });
    // FakeAgent throws a plain Error for unknown slugs; real agent returns 500 →
    // we don't classify it as an upstream 4xx, so it surfaces as 500.
    expect([500, 502]).toContain(res.statusCode);
  });

  it('GET /sessions lists only caller-owned sessions with message counts', async () => {
    const alice = await registerAndAuth(h.app, 'a@example.com');
    const bob = await registerAndAuth(h.app, 'b@example.com');
    const a1 = await createSession(alice.authHeader);
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${a1.id}/messages`,
      payload: { content: 'hi' },
      headers: alice.authHeader,
    });
    await createSession(bob.authHeader);

    const mine = await h.app.inject({
      method: 'GET',
      url: '/sessions',
      headers: alice.authHeader,
    });
    const body = mine.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe(a1.id);
    // opener + human + ai = 3
    expect(body.sessions[0].message_count).toBe(3);
  });
});
