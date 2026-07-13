import { describe, expect, it, vi, beforeEach } from 'vitest';

const requestMock = vi.fn();

vi.mock('undici', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

const { HttpAgentClient, AgentRequestError, parseAgentSSE } = await import('../src/agent/client.js');

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: { text: async () => JSON.stringify(body) },
  };
}

interface RequestOpts {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

function lastCall(): [string, RequestOpts] {
  const call = requestMock.mock.calls.at(-1);
  if (!call) throw new Error('request() was not called');
  return call as [string, RequestOpts];
}

describe('HttpAgentClient', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('throws when constructed without a baseUrl', () => {
    expect(() => new HttpAgentClient('')).toThrow('HttpAgentClient: baseUrl is required');
  });

  it('normalizes the base URL when it lacks a trailing slash', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { status: 'ok' }));
    const client = new HttpAgentClient('http://agent:8000');
    await client.health();
    expect(requestMock).toHaveBeenCalledWith(
      'http://agent:8000/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('omits X-Internal-Key when no internal key is configured', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { status: 'ok' }));
    const client = new HttpAgentClient('http://agent:8000/');
    await client.health();
    const [, opts] = lastCall();
    expect(opts.headers['X-Internal-Key']).toBeUndefined();
  });

  it('attaches X-Internal-Key when an internal key is configured', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { status: 'ok' }));
    const client = new HttpAgentClient('http://agent:8000/', { internalKey: 'secret' });
    await client.health();
    const [, opts] = lastCall();
    expect(opts.headers['X-Internal-Key']).toBe('secret');
  });

  it('health() GETs /health and returns the parsed body', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { status: 'ok' }));
    const client = new HttpAgentClient('http://agent:8000');
    await expect(client.health()).resolves.toEqual({ status: 'ok' });
  });

  it('listSimulations() GETs /simulations', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { simulations: [] }));
    const client = new HttpAgentClient('http://agent:8000');
    await expect(client.listSimulations()).resolves.toEqual({ simulations: [] });
    expect(requestMock).toHaveBeenCalledWith(
      'http://agent:8000/simulations',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getSimulation() URL-encodes the slug', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { slug: 'a b' }));
    const client = new HttpAgentClient('http://agent:8000');
    await client.getSimulation('a b');
    expect(requestMock).toHaveBeenCalledWith(
      'http://agent:8000/simulations/a%20b',
      expect.anything(),
    );
  });

  it('listPersonas() GETs /personas', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { personas: [] }));
    const client = new HttpAgentClient('http://agent:8000');
    await expect(client.listPersonas()).resolves.toEqual({ personas: [] });
  });

  it('getJson() throws AgentRequestError on non-2xx responses', async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 404,
      headers: {},
      body: { text: async () => 'not found' },
    });
    const client = new HttpAgentClient('http://agent:8000');
    const err = await client.listSimulations().catch((e) => e);
    expect(err).toBeInstanceOf(AgentRequestError);
    expect(err.status).toBe(404);
    expect(err.body).toBe('not found');
    expect(err.message).toContain('agent GET /simulations failed (404)');
  });

  it('postJson() sends a JSON body and content-type header', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new HttpAgentClient('http://agent:8000');
    await client.initConversation({ simulationSlug: 'sim-1', sessionId: 's-1' });
    const [url, opts] = lastCall();
    expect(url).toBe('http://agent:8000/conversation/init');
    expect(opts.method).toBe('POST');
    expect(opts.headers['content-type']).toBe('application/json');
    expect(JSON.parse(opts.body!)).toEqual({ simulation_slug: 'sim-1', session_id: 's-1' });
  });

  it('postJson() throws AgentRequestError on non-2xx responses', async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 500,
      headers: {},
      body: { text: async () => 'boom' },
    });
    const client = new HttpAgentClient('http://agent:8000');
    const err = await client
      .initConversation({ simulationSlug: 'sim-1' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AgentRequestError);
    expect(err.status).toBe(500);
    expect(err.body).toBe('boom');
  });

  it('turn() posts state + user messages to /conversation/turn', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { state: {}, messages: [], goal_progress: [], analysis: {} }));
    const client = new HttpAgentClient('http://agent:8000');
    await client.turn({ state: { session_id: 's-1' }, userMessages: ['hi', 'there'] });
    const [url, opts] = lastCall();
    expect(url).toBe('http://agent:8000/conversation/turn');
    expect(JSON.parse(opts.body!)).toEqual({
      state: { session_id: 's-1' },
      user_messages: ['hi', 'there'],
    });
  });

  it('proactive() posts state + trigger type to /conversation/proactive', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { state: {}, messages: [], goal_progress: [], analysis: {} }));
    const client = new HttpAgentClient('http://agent:8000');
    await client.proactive({ state: { session_id: 's-1' }, triggerType: 'inactivity' });
    const [url, opts] = lastCall();
    expect(url).toBe('http://agent:8000/conversation/proactive');
    expect(JSON.parse(opts.body!)).toEqual({
      state: { session_id: 's-1' },
      trigger_type: 'inactivity',
    });
  });

  describe('getPersonaAvatar', () => {
    it('URL-encodes the slug and returns headers + body stream', async () => {
      const body = (async function* () {
        yield Buffer.from('img');
      })();
      requestMock.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'image/png' },
        body,
      });
      const client = new HttpAgentClient('http://agent:8000');
      const res = await client.getPersonaAvatar({ slug: 'a b' });
      expect(requestMock).toHaveBeenCalledWith(
        'http://agent:8000/personas/a%20b/avatar',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.body).toBe(body);
    });

    it('throws AgentRequestError on non-2xx responses', async () => {
      requestMock.mockResolvedValueOnce({
        statusCode: 404,
        headers: {},
        body: { text: async () => 'missing' },
      });
      const client = new HttpAgentClient('http://agent:8000');
      const err = await client.getPersonaAvatar({ slug: 'nope' }).catch((e) => e);
      expect(err).toBeInstanceOf(AgentRequestError);
      expect(err.status).toBe(404);
      expect(err.body).toBe('missing');
    });

    it('forwards the abort signal', async () => {
      requestMock.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: (async function* () {})(),
      });
      const client = new HttpAgentClient('http://agent:8000');
      const controller = new AbortController();
      await client.getPersonaAvatar({ slug: 'alex', signal: controller.signal });
      const [, opts] = lastCall();
      expect(opts.signal).toBe(controller.signal);
    });
  });

  describe('streamTurn / streamProactive', () => {
    function sseBodyFromChunks(chunks: string[]) {
      return (async function* () {
        for (const chunk of chunks) {
          yield Buffer.from(chunk);
        }
      })();
    }

    it('streams parsed message/done events from /conversation/turn/stream', async () => {
      const sse =
        'event: message\ndata: {"content":"hi","typing_delay_sec":0.1}\n\n' +
        'event: done\ndata: {"state":{},"messages":[],"goal_progress":[]}\n\n';
      requestMock.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: sseBodyFromChunks([sse]),
      });
      const client = new HttpAgentClient('http://agent:8000');
      const events = [];
      for await (const event of client.streamTurn({
        state: { session_id: 's-1' },
        userMessages: ['hi'],
      })) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: 'message', data: { content: 'hi', typing_delay_sec: 0.1 } },
        { type: 'done', data: { state: {}, messages: [], goal_progress: [] } },
      ]);
      const [url, opts] = lastCall();
      expect(url).toBe('http://agent:8000/conversation/turn/stream');
      expect(opts.headers.accept).toBe('text/event-stream');
    });

    it('streams events for /conversation/proactive/stream', async () => {
      const sse = 'event: message\ndata: {"content":"hey","typing_delay_sec":0}\n\n';
      requestMock.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: sseBodyFromChunks([sse]),
      });
      const client = new HttpAgentClient('http://agent:8000');
      const events = [];
      for await (const event of client.streamProactive({
        state: { session_id: 's-1' },
        triggerType: 'start',
      })) {
        events.push(event);
      }
      expect(events).toEqual([{ type: 'message', data: { content: 'hey', typing_delay_sec: 0 } }]);
      const [url, opts] = lastCall();
      expect(url).toBe('http://agent:8000/conversation/proactive/stream');
      expect(JSON.parse(opts.body!)).toEqual({ state: { session_id: 's-1' }, trigger_type: 'start' });
    });

    it('throws AgentRequestError when the stream endpoint responds with a non-2xx status', async () => {
      requestMock.mockResolvedValueOnce({
        statusCode: 503,
        headers: {},
        body: { text: async () => 'unavailable' },
      });
      const client = new HttpAgentClient('http://agent:8000');
      const iterator = client.streamTurn({ state: {}, userMessages: ['hi'] })[Symbol.asyncIterator]();
      const err = await iterator.next().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AgentRequestError);
      expect((err as InstanceType<typeof AgentRequestError>).status).toBe(503);
      expect((err as InstanceType<typeof AgentRequestError>).body).toBe('unavailable');
    });

    it('forwards the abort signal on stream requests', async () => {
      requestMock.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: sseBodyFromChunks([]),
      });
      const client = new HttpAgentClient('http://agent:8000');
      const controller = new AbortController();
      const events = [];
      for await (const event of client.streamTurn({
        state: {},
        userMessages: ['hi'],
        signal: controller.signal,
      })) {
        events.push(event);
      }
      const [, opts] = lastCall();
      expect(opts.signal).toBe(controller.signal);
    });
  });
});

describe('parseAgentSSE', () => {
  async function collect(source: AsyncIterable<Buffer | Uint8Array | string>) {
    const events = [];
    for await (const event of parseAgentSSE(source)) {
      events.push(event);
    }
    return events;
  }

  it('parses message and done events split across multiple chunks', async () => {
    async function* chunks() {
      yield 'event: message\ndata: {"content":"a"';
      yield '}\n\n';
      yield 'event: done\ndata: {"state":{}}\n\n';
    }
    const events = await collect(chunks());
    expect(events).toEqual([
      { type: 'message', data: { content: 'a' } },
      { type: 'done', data: { state: {} } },
    ]);
  });

  it('accepts raw string chunks as well as buffers', async () => {
    async function* chunks() {
      yield 'event: message\ndata: {"content":"str"}\n\n';
    }
    const events = await collect(chunks());
    expect(events).toEqual([{ type: 'message', data: { content: 'str' } }]);
  });

  it('ignores events with an unknown event type', async () => {
    async function* chunks() {
      yield 'event: ping\ndata: {"x":1}\n\n';
    }
    expect(await collect(chunks())).toEqual([]);
  });

  it('ignores events with malformed JSON data', async () => {
    async function* chunks() {
      yield 'event: message\ndata: not-json\n\n';
      yield 'event: done\ndata: {"state":{}}\n\n';
    }
    const events = await collect(chunks());
    expect(events).toEqual([{ type: 'done', data: { state: {} } }]);
  });

  it('ignores events with no data payload', async () => {
    async function* chunks() {
      yield 'event: message\n\n';
    }
    expect(await collect(chunks())).toEqual([]);
  });

  it('yields nothing for an empty stream', async () => {
    async function* chunks() {}
    expect(await collect(chunks())).toEqual([]);
  });
});
