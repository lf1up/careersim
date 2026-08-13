import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentMessage, AgentStreamEvent, AgentWireState } from '../src/agent/types.js';

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
        url: '/v1/sessions',
        payload: { simulation_slug: SLUG },
        headers: authHeader,
      })
    ).json();

    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/messages/stream`,
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
      url: `/v1/sessions/${session.id}`,
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
        url: '/v1/sessions',
        payload: { simulation_slug: SLUG },
        headers: authHeader,
      })
    ).json();

    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/messages/stream`,
      payload: { content: 'spoken hi', source: 'voice' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/v1/sessions/${session.id}`,
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
        url: '/v1/sessions',
        payload: { simulation_slug: SLUG },
        headers: authHeader,
      })
    ).json();

    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/messages/stream`,
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
      url: `/v1/sessions/${session.id}`,
      headers: authHeader,
    });
    const tail = detail.json().messages.slice(-3);
    expect(tail).toEqual([
      expect.objectContaining({ role: 'human', content: 'first thought' }),
      expect.objectContaining({ role: 'human', content: 'second thought' }),
      expect.objectContaining({ role: 'ai', content: 'echo:first thought\nsecond thought' }),
    ]);
  });

  it('a new turn supersedes an in-flight turn for the same session', async () => {
    // The per-session turn registry aborts the previous in-flight turn and
    // awaits its cleanup before the new turn loads state, so two turns can
    // never race their version-guarded persists into a TURN_CONFLICT.
    class GatedAgent extends FakeAgent {
      firstStarted!: Promise<void>;
      firstAborted!: Promise<void>;
      private signalStarted!: () => void;
      private turnIndex = 0;

      constructor() {
        super();
        this.firstStarted = new Promise((r) => (this.signalStarted = r));
        this.firstAborted = new Promise((r) => (this.signalAborted = r));
      }

      private signalAborted!: () => void;

      override async *streamTurn(args: {
        state: AgentWireState;
        userMessages: string[];
        signal?: AbortSignal;
      }): AsyncIterable<AgentStreamEvent> {
        const index = this.turnIndex++;
        if (index === 0) {
          this.signalStarted();
          // Stay "in flight" until aborted (or the test ends), like a real
          // agent fetch mid-generation.
          await new Promise<void>((resolve) => {
            if (args.signal?.aborted) return resolve();
            args.signal?.addEventListener('abort', () => {
              this.signalAborted();
              resolve();
            });
          });
          // The proxy must not persist or forward anything from the
          // superseded turn, even though the agent still yields events.
          yield* super.streamTurn(args);
          return;
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
          url: '/v1/sessions',
          payload: { simulation_slug: SLUG },
          headers: authHeader,
        })
      ).json();

      // Start the first turn; it loads the session then blocks in the agent.
      const firstReq = gh.app.inject({
        method: 'POST',
        url: `/v1/sessions/${session.id}/messages/stream`,
        payload: { content: 'slow turn' },
        headers: authHeader,
      });
      await gated.firstStarted;

      // The second turn supersedes: it aborts the first, awaits its
      // cleanup, then runs to completion without any conflict.
      const second = await gh.app.inject({
        method: 'POST',
        url: `/v1/sessions/${session.id}/messages/stream`,
        payload: { content: 'fast turn' },
        headers: authHeader,
      });
      await gated.firstAborted;
      expect(parseSSE(second.body).map((e) => e.event)).toEqual(['message', 'done']);

      // The superseded turn ends quietly: no done, no error event.
      const first = await firstReq;
      const firstEvents = parseSSE(first.body);
      expect(firstEvents.some((e) => e.event === 'done')).toBe(false);
      expect(firstEvents.some((e) => e.event === 'error')).toBe(false);

      // Only the superseding turn is in the transcript.
      const detail = await gh.app.inject({
        method: 'GET',
        url: `/v1/sessions/${session.id}`,
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
        url: '/v1/sessions',
        payload: { simulation_slug: SLUG },
        headers: authHeader,
      })
    ).json();
    const currentCount = session.messages.length;

    // Stale precondition: the caller based its turn on a shorter
    // transcript than what is now committed.
    const stale = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/messages/stream`,
      payload: { content: 'raced turn', expected_message_count: Math.max(0, currentCount - 1) },
      headers: authHeader,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('TURN_CONFLICT');

    // Nothing ran or persisted for the rejected turn.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/v1/sessions/${session.id}`,
      headers: authHeader,
    });
    expect(detail.json().messages.length).toBe(currentCount);

    // A matching precondition streams normally.
    const fresh = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/messages/stream`,
      payload: { content: 'fresh turn', expected_message_count: currentCount },
      headers: authHeader,
    });
    expect(fresh.statusCode).toBe(200);
    expect(parseSSE(fresh.body).map((e) => e.event)).toEqual(['message', 'done']);
  });

  it('keeps the bubbles already delivered when the client disconnects mid-turn', async () => {
    // The web client interrupts a turn by closing the SSE and sending a new
    // message. Incremental persistence means everything already forwarded
    // survives — the transcript must contain the human message and the
    // first AI bubble, while the unfinished remainder of the turn (the
    // final state at `done`) is dropped.
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
          url: '/v1/sessions',
          payload: { simulation_slug: SLUG },
          headers: authHeader,
        })
      ).json();
      const before = session.messages.length;

      // Real socket (not inject) so aborting actually closes the connection.
      const controller = new AbortController();
      const resp = await fetch(`${base}/v1/sessions/${session.id}/messages/stream`, {
        method: 'POST',
        headers: { ...authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'interrupted turn' }),
        signal: controller.signal,
      });
      const reader = resp.body!.getReader();
      await gated.firstBubbleSent;
      await reader.read(); // consume the first bubble, then hang up
      controller.abort();

      // Give the close event a beat to reach the server, then let the
      // agent stream finish — the proxy must not persist the final state.
      await new Promise((r) => setTimeout(r, 150));
      gated.release();
      await new Promise((r) => setTimeout(r, 250));

      const messages = (
        await gh.app.inject({
          method: 'GET',
          url: `/v1/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages;
      // Exactly the delivered prefix: the human message + the first bubble.
      expect(messages.length).toBe(before + 2);
      expect(messages.slice(-2)).toEqual([
        expect.objectContaining({ role: 'human', content: 'interrupted turn' }),
        expect.objectContaining({ role: 'ai', content: 'echo:interrupted turn' }),
      ]);
    } finally {
      await gh.close();
    }
  });

  it('persists each streamed message before forwarding it', async () => {
    // Mid-burst, the transcript must already contain the first AI bubble
    // while the follow-up is still generating — "seen by the client"
    // implies "persisted".
    class BurstAgent extends FakeAgent {
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
        const prior = args.state.messages ?? [];
        const humans = args.userMessages.map<AgentMessage>((m) => ({
          role: 'human',
          content: m,
        }));
        const afterFirst: AgentWireState = {
          ...args.state,
          messages: [...prior, ...humans, { role: 'ai', content: 'bubble one' }],
        };
        const afterSecond: AgentWireState = {
          ...args.state,
          messages: [
            ...prior,
            ...humans,
            { role: 'ai', content: 'bubble one' },
            { role: 'ai', content: 'bubble two' },
          ],
        };
        yield {
          type: 'message',
          data: {
            content: 'bubble one',
            typing_delay_sec: 0.1,
            is_followup: false,
            state: afterFirst,
          },
        };
        this.signalBubble();
        await this.gate; // follow-up still "generating"
        yield {
          type: 'message',
          data: {
            content: 'bubble two',
            typing_delay_sec: 0.1,
            is_followup: true,
            state: afterSecond,
          },
        };
        yield {
          type: 'done',
          data: { state: afterSecond, messages: afterSecond.messages ?? [], goal_progress: [] },
        };
      }
    }

    const burst = new BurstAgent();
    const gh = await buildTestApp({ agent: burst });
    try {
      await gh.app.listen({ port: 0, host: '127.0.0.1' });
      const address = gh.app.server.address();
      const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

      const { authHeader } = await registerAndAuth(gh.app);
      const session = (
        await gh.app.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: { simulation_slug: SLUG },
          headers: authHeader,
        })
      ).json();
      const before = session.messages.length;

      const controller = new AbortController();
      const resp = await fetch(`${base}/v1/sessions/${session.id}/messages/stream`, {
        method: 'POST',
        headers: { ...authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'burst please' }),
        signal: controller.signal,
      });
      const reader = resp.body!.getReader();
      await burst.firstBubbleSent;
      await reader.read(); // first bubble delivered

      // While the follow-up is still gated, the transcript must already
      // contain the human message and the first bubble.
      const midTurn = (
        await gh.app.inject({
          method: 'GET',
          url: `/v1/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages;
      expect(midTurn.length).toBe(before + 2);
      expect(midTurn.slice(-2)).toEqual([
        expect.objectContaining({ role: 'human', content: 'burst please' }),
        expect.objectContaining({ role: 'ai', content: 'bubble one' }),
      ]);

      burst.release();
      // Drain the stream to completion.
      while (!(await reader.read()).done) {
        /* consume */
      }

      const afterTurn = (
        await gh.app.inject({
          method: 'GET',
          url: `/v1/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages;
      expect(afterTurn.length).toBe(before + 3);
      expect(afterTurn[afterTurn.length - 1]).toEqual(
        expect.objectContaining({ role: 'ai', content: 'bubble two' }),
      );
    } finally {
      await gh.close();
    }
  });

  it('keeps the delivered bubble when the agent stream fails before done', async () => {
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
          url: '/v1/sessions',
          payload: { simulation_slug: SLUG },
          headers: authHeader,
        })
      ).json();
      const before = (
        await fh.app.inject({
          method: 'GET',
          url: `/v1/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages.length;

      const res = await fh.app.inject({
        method: 'POST',
        url: `/v1/sessions/${session.id}/messages/stream`,
        payload: { content: 'doomed turn' },
        headers: authHeader,
      });
      const events = parseSSE(res.body);
      expect(events.some((e) => e.event === 'error')).toBe(true);
      expect(events.some((e) => e.event === 'done')).toBe(false);

      // The bubble the client already saw was persisted incrementally;
      // only the unfinished remainder of the turn is missing.
      const after = (
        await fh.app.inject({
          method: 'GET',
          url: `/v1/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages;
      expect(after.length).toBe(before + 2);
      expect(after.slice(-2)).toEqual([
        expect.objectContaining({ role: 'human', content: 'doomed turn' }),
        expect.objectContaining({ role: 'ai', content: 'echo:doomed turn' }),
      ]);
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
        url: '/v1/sessions',
        payload: { simulation_slug: SLUG },
        headers: alice.authHeader,
      })
    ).json();

    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${session.id}/messages/stream`,
      payload: { content: 'hi' },
      headers: bob.authHeader,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /internal/sessions/:id/messages/stream (worker turn route)', () => {
  const INTERNAL_KEY = 'test-internal-key';

  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp({ voice: { enabled: true, internalKey: INTERNAL_KEY } });
  });
  afterEach(async () => {
    await h.close();
  });

  async function createSession(headers: Record<string, string>): Promise<{ id: string }> {
    return (
      await h.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        payload: { simulation_slug: SLUG },
        headers,
      })
    ).json();
  }

  it('streams and persists a spoken turn under the internal key — no user JWT involved', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);

    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/internal/sessions/${session.id}/messages/stream`,
      payload: { content: 'spoken hi', source: 'voice' },
      headers: { 'x-internal-key': INTERNAL_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSSE(res.body);
    expect(events.map((e) => e.event)).toEqual(['message', 'done']);

    // Persisted as a voice turn, readable by the session owner.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/v1/sessions/${session.id}`,
      headers: authHeader,
    });
    const tail = detail.json().messages.slice(-2);
    expect(tail).toEqual([
      expect.objectContaining({ role: 'human', content: 'spoken hi', source: 'voice' }),
      expect.objectContaining({ role: 'ai', content: 'echo:spoken hi', source: 'voice' }),
    ]);
  });

  it('does not persist a turn whose client disconnected before done', async () => {
    // The voice worker abandons a turn by closing the SSE and re-sends the
    // messages in a new request. If generation already finished when the
    // client hung up, persisting anyway would duplicate the re-sent turn —
    // the internal route stays done-only and must drop the result instead.
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
    const gh = await buildTestApp({
      agent: gated,
      voice: { enabled: true, internalKey: INTERNAL_KEY },
    });
    try {
      await gh.app.listen({ port: 0, host: '127.0.0.1' });
      const address = gh.app.server.address();
      const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

      const { authHeader } = await registerAndAuth(gh.app);
      const session = (
        await gh.app.inject({
          method: 'POST',
          url: '/v1/sessions',
          payload: { simulation_slug: SLUG },
          headers: authHeader,
        })
      ).json();
      const before = session.messages.length;

      // Real socket (not inject) so aborting actually closes the connection.
      const controller = new AbortController();
      const resp = await fetch(`${base}/v1/internal/sessions/${session.id}/messages/stream`, {
        method: 'POST',
        headers: { 'x-internal-key': INTERNAL_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'abandoned turn', source: 'voice' }),
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
          url: `/v1/sessions/${session.id}`,
          headers: authHeader,
        })
      ).json().messages.length;
      expect(after).toBe(before);
    } finally {
      await gh.close();
    }
  });

  it('rejects calls without the internal key (401) and ignores user JWTs', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const session = await createSession(authHeader);

    const noKey = await h.app.inject({
      method: 'POST',
      url: `/v1/internal/sessions/${session.id}/messages/stream`,
      payload: { content: 'hi' },
    });
    expect(noKey.statusCode).toBe(401);

    const wrongKey = await h.app.inject({
      method: 'POST',
      url: `/v1/internal/sessions/${session.id}/messages/stream`,
      payload: { content: 'hi' },
      headers: { 'x-internal-key': 'wrong-key' },
    });
    expect(wrongKey.statusCode).toBe(401);

    // A valid user JWT is NOT a credential for the internal surface.
    const bearerOnly = await h.app.inject({
      method: 'POST',
      url: `/v1/internal/sessions/${session.id}/messages/stream`,
      payload: { content: 'hi' },
      headers: authHeader,
    });
    expect(bearerOnly.statusCode).toBe(401);
  });

  it('503s when the internal key is unset (fail-closed)', async () => {
    // No voice config at all → internalKey defaults to '' and the route
    // must refuse rather than accept unauthenticated "internal" calls.
    const fh = await buildTestApp();
    try {
      const res = await fh.app.inject({
        method: 'POST',
        url: '/v1/internal/sessions/00000000-0000-0000-0000-000000000000/messages/stream',
        payload: { content: 'hi' },
        headers: { 'x-internal-key': 'anything' },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await fh.close();
    }
  });
});
