import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentStreamEvent, AgentWireState } from '../src/agent/types.js';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';
import { FakeAgent } from './helpers/fake-agent.js';

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
      expect.objectContaining({ role: 'human', content: 'streamed hi', source: 'text' }),
      expect.objectContaining({ role: 'ai', content: 'echo:streamed hi', source: 'text' }),
    ]);
  });

  it('tags the persisted delta with source=voice when the worker streams a spoken turn', async () => {
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
      payload: { content: 'spoken hi', source: 'voice' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    const tail = detail.json().messages.slice(-2);
    expect(tail).toEqual([
      expect.objectContaining({ role: 'human', content: 'spoken hi', source: 'voice' }),
      expect.objectContaining({ role: 'ai', content: 'echo:spoken hi', source: 'voice' }),
    ]);
  });

  it('persists one human row per item when content is an array', async () => {
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
      payload: { content: ['first thought', 'second thought'] },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);

    const events = parseSSE(res.body);
    expect(events[events.length - 1]!.event).toBe('done');

    // Each batched user message is its own bubble; the persona composed
    // one reply to the whole batch.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    const tail = detail.json().messages.slice(-3);
    expect(tail).toEqual([
      expect.objectContaining({ role: 'human', content: 'first thought' }),
      expect.objectContaining({ role: 'human', content: 'second thought' }),
      expect.objectContaining({ role: 'ai', content: 'echo:first thought\nsecond thought' }),
    ]);
  });

  it('emits a TURN_CONFLICT error (and persists nothing) when a concurrent turn commits first', async () => {
    // The first stream is gated open until a second full turn commits, so
    // its persist runs against a stale session version. Pre-fix this was a
    // silent lost update; now it must surface as a coded SSE error.
    class GatedAgent extends FakeAgent {
      releaseFirst!: () => void;
      firstStarted!: Promise<void>;
      private signalStarted!: () => void;
      private gate: Promise<void>;
      private turnIndex = 0;

      constructor() {
        super();
        this.firstStarted = new Promise((r) => (this.signalStarted = r));
        this.gate = new Promise((r) => (this.releaseFirst = r));
      }

      override async *streamTurn(args: {
        state: AgentWireState;
        userMessages: string[];
        signal?: AbortSignal;
      }): AsyncIterable<AgentStreamEvent> {
        const index = this.turnIndex++;
        if (index === 0) {
          this.signalStarted();
          await this.gate;
        }
        yield* super.streamTurn(args);
      }
    }

    const gated = new GatedAgent();
    const gh = await buildTestApp({ agent: gated });
    try {
      const { authHeader } = await registerAndAuth(gh.app);
      const session = (
        await gh.app.inject({
          method: 'POST',
          url: '/sessions',
          payload: { simulation_slug: SLUG },
          headers: authHeader,
        })
      ).json();

      // Start the first turn; it loads the session then blocks in the agent.
      const firstReq = gh.app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages/stream`,
        payload: { content: 'slow turn' },
        headers: authHeader,
      });
      await gated.firstStarted;

      // A second turn runs to completion and bumps the session version.
      const second = await gh.app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages/stream`,
        payload: { content: 'fast turn' },
        headers: authHeader,
      });
      expect(parseSSE(second.body).map((e) => e.event)).toEqual(['message', 'done']);

      // Unblock the first turn: its persist must now 409, not overwrite.
      gated.releaseFirst();
      const first = await firstReq;
      const firstEvents = parseSSE(first.body);
      const errorEvent = firstEvents.find((e) => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as { code?: string }).code).toBe('TURN_CONFLICT');
      expect(firstEvents.some((e) => e.event === 'done')).toBe(false);

      // Only the committed (fast) turn is in the transcript — the stale
      // turn persisted nothing.
      const detail = await gh.app.inject({
        method: 'GET',
        url: `/sessions/${session.id}`,
        headers: authHeader,
      });
      const contents = detail
        .json()
        .messages.map((m: { content: string }) => m.content);
      expect(contents).toContain('fast turn');
      expect(contents).not.toContain('slow turn');
    } finally {
      await gh.close();
    }
  });

  it('rejects a stream whose expected_message_count no longer matches with 409 TURN_CONFLICT', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = (
      await h.app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { simulation_slug: SLUG },
        headers: authHeader,
      })
    ).json();
    const currentCount = session.messages.length;

    // Stale precondition: the caller based its turn on a shorter
    // transcript than what is now committed.
    const stale = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages/stream`,
      payload: { content: 'raced turn', expected_message_count: Math.max(0, currentCount - 1) },
      headers: authHeader,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('TURN_CONFLICT');

    // Nothing ran or persisted for the rejected turn.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: authHeader,
    });
    expect(detail.json().messages.length).toBe(currentCount);

    // A matching precondition streams normally.
    const fresh = await h.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/messages/stream`,
      payload: { content: 'fresh turn', expected_message_count: currentCount },
      headers: authHeader,
    });
    expect(fresh.statusCode).toBe(200);
    expect(parseSSE(fresh.body).map((e) => e.event)).toEqual(['message', 'done']);
  });

  it('does not persist a turn whose client disconnected before done', async () => {
    // The voice worker abandons a turn by closing the SSE and re-sends the
    // messages in a new request. If generation already finished when the
    // client hung up, persisting anyway would duplicate the re-sent turn —
    // the proxy must drop the result instead.
    class GatedAgent extends FakeAgent {
      release!: () => void;
      firstBubbleSent!: Promise<void>;
      private signalBubble!: () => void;
      private gate: Promise<void>;

      constructor() {
        super();
        this.firstBubbleSent = new Promise((r) => (this.signalBubble = r));
        this.gate = new Promise((r) => (this.release = r));
      }

      override async *streamTurn(args: {
        state: AgentWireState;
        userMessages: string[];
        signal?: AbortSignal;
      }): AsyncIterable<AgentStreamEvent> {
        const events: AgentStreamEvent[] = [];
        for await (const event of super.streamTurn(args)) events.push(event);
        yield events[0]!; // the reply bubble reaches the client...
        this.signalBubble();
        await this.gate; // ...then generation "finishes" after the client left
        yield* events.slice(1);
      }
    }

    const gated = new GatedAgent();
    const gh = await buildTestApp({ agent: gated });
    try {
      await gh.app.listen({ port: 0, host: '127.0.0.1' });
      const address = gh.app.server.address();
      const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

      const { authHeader } = await registerAndAuth(gh.app);
      const session = (
        await gh.app.inject({
          method: 'POST',
          url: '/sessions',
          payload: { simulation_slug: SLUG },
          headers: authHeader,
        })
      ).json();
      const before = session.messages.length;

      // Real socket (not inject) so aborting actually closes the connection.
      const controller = new AbortController();
      const resp = await fetch(`${base}/sessions/${session.id}/messages/stream`, {
        method: 'POST',
        headers: { ...authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'abandoned turn' }),
        signal: controller.signal,
      });
      const reader = resp.body!.getReader();
      await gated.firstBubbleSent;
      await reader.read(); // consume the first bubble, then hang up
      controller.abort();

      // Give the close event a beat to reach the server, then let the
      // agent stream finish — the proxy must skip the persist.
      await new Promise((r) => setTimeout(r, 150));
      gated.release();
      await new Promise((r) => setTimeout(r, 250));

      const after = (
        await gh.app.inject({
          method: 'GET',
          url: `/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages.length;
      expect(after).toBe(before);
    } finally {
      await gh.close();
    }
  });

  it('persists nothing when the agent stream fails before done', async () => {
    class FailingAgent extends FakeAgent {
      override async *streamTurn(args: {
        state: AgentWireState;
        userMessages: string[];
        signal?: AbortSignal;
      }): AsyncIterable<AgentStreamEvent> {
        for await (const event of super.streamTurn(args)) {
          if (event.type === 'done') {
            throw new Error('upstream died mid-turn');
          }
          yield event;
        }
      }
    }

    const fh = await buildTestApp({ agent: new FailingAgent() });
    try {
      const { authHeader } = await registerAndAuth(fh.app);
      const session = (
        await fh.app.inject({
          method: 'POST',
          url: '/sessions',
          payload: { simulation_slug: SLUG },
          headers: authHeader,
        })
      ).json();
      const before = (
        await fh.app.inject({
          method: 'GET',
          url: `/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages.length;

      const res = await fh.app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages/stream`,
        payload: { content: 'doomed turn' },
        headers: authHeader,
      });
      const events = parseSSE(res.body);
      expect(events.some((e) => e.event === 'error')).toBe(true);
      expect(events.some((e) => e.event === 'done')).toBe(false);

      // Nothing was persisted — persistence only happens on `done`.
      const after = (
        await fh.app.inject({
          method: 'GET',
          url: `/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages.length;
      expect(after).toBe(before);
    } finally {
      await fh.close();
    }
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
