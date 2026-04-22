import { request } from 'undici';
import { createParser, type EventSourceMessage } from 'eventsource-parser';

import type {
  AgentConversationResponse,
  AgentPersonasResponse,
  AgentSimulationDetail,
  AgentSimulationsResponse,
  AgentStreamEvent,
  AgentWireState,
  ProactiveTrigger,
} from './types.js';

export interface AgentClient {
  health(): Promise<{ status: string }>;
  listSimulations(): Promise<AgentSimulationsResponse>;
  getSimulation(slug: string): Promise<AgentSimulationDetail>;
  listPersonas(): Promise<AgentPersonasResponse>;
  initConversation(args: {
    simulationSlug: string;
    sessionId?: string;
  }): Promise<AgentConversationResponse>;
  turn(args: {
    state: AgentWireState;
    userMessage: string;
  }): Promise<AgentConversationResponse>;
  proactive(args: {
    state: AgentWireState;
    triggerType: ProactiveTrigger;
  }): Promise<AgentConversationResponse>;
  streamTurn(args: {
    state: AgentWireState;
    userMessage: string;
    signal?: AbortSignal;
  }): AsyncIterable<AgentStreamEvent>;
  streamProactive(args: {
    state: AgentWireState;
    triggerType: ProactiveTrigger;
    signal?: AbortSignal;
  }): AsyncIterable<AgentStreamEvent>;
}

export class AgentRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'AgentRequestError';
  }
}

export class HttpAgentClient implements AgentClient {
  constructor(private readonly baseUrl: string) {
    if (!baseUrl) {
      throw new Error('HttpAgentClient: baseUrl is required');
    }
  }

  private url(path: string): string {
    return new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString();
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await request(this.url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new AgentRequestError(
        `agent POST ${path} failed (${res.statusCode})`,
        res.statusCode,
        text,
      );
    }
    return JSON.parse(text) as T;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await request(this.url(path), { method: 'GET' });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new AgentRequestError(
        `agent GET ${path} failed (${res.statusCode})`,
        res.statusCode,
        text,
      );
    }
    return JSON.parse(text) as T;
  }

  health(): Promise<{ status: string }> {
    return this.getJson('/health');
  }

  listSimulations(): Promise<AgentSimulationsResponse> {
    return this.getJson('/simulations');
  }

  getSimulation(slug: string): Promise<AgentSimulationDetail> {
    return this.getJson(`/simulations/${encodeURIComponent(slug)}`);
  }

  listPersonas(): Promise<AgentPersonasResponse> {
    return this.getJson('/personas');
  }

  initConversation(args: {
    simulationSlug: string;
    sessionId?: string;
  }): Promise<AgentConversationResponse> {
    return this.postJson('/conversation/init', {
      simulation_slug: args.simulationSlug,
      session_id: args.sessionId,
    });
  }

  turn(args: {
    state: AgentWireState;
    userMessage: string;
  }): Promise<AgentConversationResponse> {
    return this.postJson('/conversation/turn', {
      state: args.state,
      user_message: args.userMessage,
    });
  }

  proactive(args: {
    state: AgentWireState;
    triggerType: ProactiveTrigger;
  }): Promise<AgentConversationResponse> {
    return this.postJson('/conversation/proactive', {
      state: args.state,
      trigger_type: args.triggerType,
    });
  }

  async *streamTurn(args: {
    state: AgentWireState;
    userMessage: string;
    signal?: AbortSignal;
  }): AsyncIterable<AgentStreamEvent> {
    yield* this.postSSE('/conversation/turn/stream', {
      state: args.state,
      user_message: args.userMessage,
    }, args.signal);
  }

  async *streamProactive(args: {
    state: AgentWireState;
    triggerType: ProactiveTrigger;
    signal?: AbortSignal;
  }): AsyncIterable<AgentStreamEvent> {
    yield* this.postSSE('/conversation/proactive/stream', {
      state: args.state,
      trigger_type: args.triggerType,
    }, args.signal);
  }

  private async *postSSE(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): AsyncIterable<AgentStreamEvent> {
    const res = await request(this.url(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      throw new AgentRequestError(
        `agent POST ${path} failed (${res.statusCode})`,
        res.statusCode,
        text,
      );
    }
    yield* parseAgentSSE(res.body);
  }
}

/**
 * Convert a raw SSE byte stream into typed agent events.
 *
 * The agent emits:
 *   event: message   data: <AgentStreamMessageEvent JSON>
 *   event: done      data: <AgentStreamDoneEvent JSON>
 */
export async function* parseAgentSSE(
  source: AsyncIterable<Buffer | Uint8Array | string>,
): AsyncIterable<AgentStreamEvent> {
  const queue: AgentStreamEvent[] = [];
  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      if (!event.event || !event.data) return;
      try {
        const data = JSON.parse(event.data);
        if (event.event === 'message') {
          queue.push({ type: 'message', data });
        } else if (event.event === 'done') {
          queue.push({ type: 'done', data });
        }
      } catch {
        /* ignore malformed event */
      }
    },
  });

  const decoder = new TextDecoder();
  for await (const chunk of source) {
    const text =
      typeof chunk === 'string' ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
    parser.feed(text);
    while (queue.length > 0) {
      yield queue.shift()!;
    }
  }
  while (queue.length > 0) {
    yield queue.shift()!;
  }
}
