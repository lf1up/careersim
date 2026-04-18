import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AgentClient } from '../../agent/client.js';
import type {
  AgentMessage,
  AgentStreamMessageEvent,
  AgentWireState,
  ProactiveTrigger,
} from '../../agent/types.js';
import type { AppDatabase } from '../../db/client.js';
import { createSessionsService } from './sessions.service.js';
import {
  createSessionSchema,
  followupProactiveSchema,
  nudgeRequestSchema,
  nudgeResponseSchema,
  sendMessageSchema,
  sessionDetailSchema,
  sessionListResponseSchema,
} from './sessions.schema.js';

interface SessionsRouteOptions {
  db: AppDatabase;
  agent: AgentClient;
  nudge: {
    minIdleSeconds: number;
    maxPerSilence: number;
  };
}

export const sessionsRoutes: FastifyPluginAsyncZod<SessionsRouteOptions> = async (app, opts) => {
  const service = createSessionsService(opts.db, opts.agent);

  app.post(
    '/sessions',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: 'Create a new conversation session',
        security: [{ bearerAuth: [] }],
        body: createSessionSchema,
        response: { 201: sessionDetailSchema },
      },
    },
    async (request, reply) => {
      const detail = await service.create(request.user.sub, request.body.simulation_slug);
      reply.code(201);
      return detail;
    },
  );

  app.get(
    '/sessions',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: "List caller's sessions",
        security: [{ bearerAuth: [] }],
        response: { 200: sessionListResponseSchema },
      },
    },
    async (request) => {
      const rows = await service.list(request.user.sub);
      return { sessions: rows };
    },
  );

  app.get(
    '/sessions/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: 'Get session detail (persisted messages + latest agent analysis)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        response: { 200: sessionDetailSchema },
      },
    },
    async (request) => {
      return service.get(request.user.sub, request.params.id);
    },
  );

  app.post(
    '/sessions/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: 'Send a user message (batch, returns full updated session)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        body: sendMessageSchema,
        response: { 200: sessionDetailSchema },
      },
    },
    async (request) => {
      return service.postMessage(request.user.sub, request.params.id, request.body.content);
    },
  );

  // ---------------------------------------------------------------------------
  // Proactive followup — batch + SSE.
  //
  // Only `followup` is accepted here. `start` runs once during /sessions
  // creation; `inactivity` goes through /sessions/:id/nudge (guardrailed).
  // ---------------------------------------------------------------------------

  app.post(
    '/sessions/:id/proactive',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: 'Trigger a batch followup message from the agent',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        body: followupProactiveSchema,
        response: { 200: sessionDetailSchema },
      },
    },
    async (request) => {
      return service.triggerFollowup(request.user.sub, request.params.id);
    },
  );

  app.post(
    '/sessions/:id/proactive/stream',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: 'Trigger a followup message and stream it back as SSE',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        body: followupProactiveSchema,
      },
    },
    async (request, reply) => {
      const trigger: ProactiveTrigger = 'followup';
      await runSseProxy(app, request, reply, {
        kind: 'proactive',
        load: () => service.prepareStream(request.user.sub, request.params.id),
        agent: (state, signal) =>
          opts.agent.streamProactive({ state, triggerType: trigger, signal }),
      });
    },
  );

  // ---------------------------------------------------------------------------
  // Inactivity nudge — batch only, guardrailed.
  // ---------------------------------------------------------------------------

  app.post(
    '/sessions/:id/nudge',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: 'Attempt an inactivity nudge (batch, rate-limited server-side)',
        description:
          'Idempotent: the server decides whether to dispatch to the agent based on `NUDGE_MIN_IDLE_SECONDS` and `NUDGE_MAX_PER_SILENCE`. Returns `{ nudged: false, reason }` if skipped.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        body: nudgeRequestSchema,
        response: { 200: nudgeResponseSchema },
      },
    },
    async (request) => {
      const override = request.body?.min_idle_seconds;
      const minIdleSeconds =
        override !== undefined
          ? Math.max(override, opts.nudge.minIdleSeconds)
          : opts.nudge.minIdleSeconds;

      return service.triggerInactivityNudge(request.user.sub, request.params.id, {
        minIdleSeconds,
        maxPerSilence: opts.nudge.maxPerSilence,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // Turn + SSE message proxy.
  // ---------------------------------------------------------------------------

  app.post(
    '/sessions/:id/messages/stream',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['sessions'],
        summary: 'Send a user message and stream AI responses (SSE)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        body: sendMessageSchema,
      },
    },
    async (request, reply) => {
      const userMessage = request.body.content;
      await runSseProxy(app, request, reply, {
        kind: 'turn',
        load: () => service.prepareStream(request.user.sub, request.params.id),
        agent: (state, signal) =>
          opts.agent.streamTurn({ state, userMessage, signal }),
      });
    },
  );
};

// ---------------------------------------------------------------------------
// Shared SSE proxy helper. Forwards every `message` event 1:1 and persists
// the delta on the final `done` event.
// ---------------------------------------------------------------------------

interface SseProxyContext {
  kind: 'turn' | 'proactive';
  load: () => Promise<{
    session: { stateSnapshot: AgentWireState };
    persist: (
      finalState: AgentWireState,
      newMessages: AgentMessage[],
    ) => Promise<unknown>;
  }>;
  agent: (
    state: AgentWireState,
    signal: AbortSignal,
  ) => AsyncIterable<
    | { type: 'message'; data: AgentStreamMessageEvent }
    | { type: 'done'; data: { state: AgentWireState; messages: AgentMessage[] } }
  >;
}

async function runSseProxy(
  app: import('fastify').FastifyInstance,
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  ctx: SseProxyContext,
): Promise<void> {
  const { session, persist } = await ctx.load();

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const abort = new AbortController();
  request.raw.once('close', () => abort.abort());

  const writeEvent = (type: string, data: unknown) => {
    reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let finalState: AgentWireState | null = null;
    for await (const event of ctx.agent(session.stateSnapshot, abort.signal)) {
      if (event.type === 'message') {
        writeEvent('message', event.data);
      } else if (event.type === 'done') {
        finalState = event.data.state;
        const persisted = await persist(event.data.state, event.data.messages ?? []);
        writeEvent('done', { state: event.data.state, session: persisted });
      }
    }
    if (!finalState) {
      writeEvent('error', { message: 'Stream ended without done event' });
    }
  } catch (err) {
    request.log.error({ err, kind: ctx.kind }, 'SSE proxy failed');
    writeEvent('error', {
      message: err instanceof Error ? err.message : 'Stream failed',
    });
  } finally {
    reply.raw.end();
  }
}
