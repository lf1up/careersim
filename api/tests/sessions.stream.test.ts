import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

const SLUG = 'behavioral-interview-brenda';

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

describe('POST /sessions/:id/messages/stream (SSE proxy)', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('emits a message event followed by a done event, and persists on done', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = (
      await h.app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { simulation_slug: SLUG },
        headers: authHeader,
      })
    ).json();

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages/stream`,
      payload: { content: 'streamed hi' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSSE(res.body);
    expect(events.map((e) => e.event)).toEqual(['message', 'done']);
    expect((events[0]!.data as { content: string }).content).toBe('echo:streamed hi');

    // After the stream completes, the session detail must reflect the persisted delta.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    const tail = detail.json().messages.slice(-2);
    expect(tail).toEqual([
      expect.objectContaining({ role: 'human', content: 'streamed hi' }),
      expect.objectContaining({ role: 'ai', content: 'echo:streamed hi' }),
    ]);
  });

  it('forbids streaming into another user\'s session', async () => {
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');
    const session = (
      await h.app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { simulation_slug: SLUG },
        headers: alice.authHeader,
      })
    ).json();

    const res = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages/stream`,
      payload: { content: 'hi' },
      headers: bob.authHeader,
    });
    expect(res.statusCode).toBe(403);
  });
});
