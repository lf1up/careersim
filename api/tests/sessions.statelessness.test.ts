import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

/**
 * The API is the *stateful* layer in front of the stateless agent. These tests
 * pin three guarantees:
 *
 *   1. The DB is the single source of truth — message history round-trips
 *      verbatim through the API (no hidden per-session caches).
 *   2. The agent is called with the caller-owned snapshot on every request;
 *      two sessions never bleed into each other.
 *   3. Replaying the same user message against the same snapshot is
 *      deterministic (this mirrors agent/tests/test_api.py::TestStatelessness).
 */

const SLUG = 'behavioral-interview-brenda';

describe('statelessness contract', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  async function createSession(auth: Record<string, string>) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { simulation_slug: SLUG },
      headers: auth,
    });
    return res.json();
  }

  it('two sessions owned by different users do not bleed', async () => {
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');

    const a = await createSession(alice.authHeader);
    const b = await createSession(bob.authHeader);

    await h.app.inject({
      method: 'POST',
      url: `/sessions/${a.id}/messages`,
      payload: { content: 'hello from A' },
      headers: alice.authHeader,
    });
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${b.id}/messages`,
      payload: { content: 'hello from B' },
      headers: bob.authHeader,
    });

    const aDetail = (
      await h.app.inject({
        method: 'GET',
        url: `/sessions/${a.id}`,
        headers: alice.authHeader,
      })
    ).json();
    const bDetail = (
      await h.app.inject({
        method: 'GET',
        url: `/sessions/${b.id}`,
        headers: bob.authHeader,
      })
    ).json();

    const aContents = aDetail.messages.map((m: { content: string }) => m.content);
    const bContents = bDetail.messages.map((m: { content: string }) => m.content);

    expect(aContents).toContain('hello from A');
    expect(aContents).not.toContain('hello from B');
    expect(bContents).toContain('hello from B');
    expect(bContents).not.toContain('hello from A');
  });

  it('replaying the same user message against a session twice is deterministic in the agent calls', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const s1 = await createSession(authHeader);
    const s2 = await createSession(authHeader);

    const r1 = (
      await h.app.inject({
        method: 'POST',
        url: `/sessions/${s1.id}/messages`,
        payload: { content: 'same question' },
        headers: authHeader,
      })
    ).json();
    const r2 = (
      await h.app.inject({
        method: 'POST',
        url: `/sessions/${s2.id}/messages`,
        payload: { content: 'same question' },
        headers: authHeader,
      })
    ).json();

    const strip = (msg: { role: string; content: string }) => ({
      role: msg.role,
      content: msg.content,
    });
    expect(r1.messages.map(strip)).toEqual(r2.messages.map(strip));
  });

  it('the API calls the agent exactly once per user turn and passes the current snapshot', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);
    h.agent.callLog.length = 0;

    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'one' },
      headers: authHeader,
    });
    await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages`,
      payload: { content: 'two' },
      headers: authHeader,
    });

    expect(h.agent.callLog).toEqual(['turn:one', 'turn:two']);
  });

  it('the DB is the source of truth: messages recovered exactly from persistence', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);

    const sent = ['first', 'second', 'third'];
    for (const content of sent) {
      await h.app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages`,
        payload: { content },
        headers: authHeader,
      });
    }

    const detail = (
      await h.app.inject({
        method: 'GET',
        url: `/sessions/${session.id}`,
        headers: authHeader,
      })
    ).json();

    const humanContents = detail.messages
      .filter((m: { role: string }) => m.role === 'human')
      .map((m: { content: string }) => m.content);
    expect(humanContents).toEqual(sent);

    const ordering = detail.messages.map((m: { order_index: number }) => m.order_index);
    expect(ordering).toEqual([...ordering].sort((a, b) => a - b));
    expect(new Set(ordering).size).toBe(ordering.length);
  });
});
