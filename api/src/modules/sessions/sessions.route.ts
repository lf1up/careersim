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
import { HttpError } from '../../plugins/errors.js';
import { rateLimitPolicy } from '../../plugins/rate-limit.js';
import { isCorsOriginAllowed } from '../../utils/cors.js';
import { createSessionsService } from './sessions.service.js';
import {
  createSessionSchema,
  followupProactiveSchema,
  nudgeResponseSchema,
  sendMessageSchema,
  sessionDetailSchema,
  sessionListResponseSchema,
} from './sessions.schema.js';

interface SessionsRouteOptions {
  db: AppDatabase;
  agent: AgentClient;
  corsAllowedOrigins?: string[];
}

export const sessionsRoutes: FastifyPluginAsyncZod<SessionsRouteOptions> = async (app, opts) => {
  const service = createSessionsService(opts.db, opts.agent);
  const corsAllowedOrigins = opts.corsAllowedOrigins ?? [];

  app.post(
    '/sessions',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimitPolicy.createSession() },
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
      config: { rateLimit: rateLimitPolicy.sendMessage() },
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
      const contents = Array.isArray(request.body.content)
        ? request.body.content
        : [request.body.content];
      return service.postMessage(request.user.sub, request.params.id, contents);
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
      config: { rateLimit: rateLimitPolicy.proactive() },
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
      config: { rateLimit: rateLimitPolicy.proactive() },
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
        corsAllowedOrigins,
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
      config: { rateLimit: rateLimitPolicy.nudge() },
      schema: {
        tags: ['sessions'],
        summary: 'Attempt an inactivity nudge (batch, persona-driven)',
        description:
          'Idempotent: the server decides whether to dispatch to the agent based on the persona\'s `conversationStyle.inactivityNudgeDelaySec` and `inactivityNudges`. Returns `{ nudged: false, reason }` if skipped.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        response: { 200: nudgeResponseSchema },
      },
    },
    async (request) => service.triggerInactivityNudge(request.user.sub, request.params.id),
  );

  // ---------------------------------------------------------------------------
  // Turn + SSE message proxy.
  // ---------------------------------------------------------------------------

  app.post(
    '/sessions/:id/messages/stream',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimitPolicy.sendMessage() },
      schema: {
        tags: ['sessions'],
        summary: 'Send a user message and stream AI responses (SSE)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        body: sendMessageSchema,
      },
    },
    async (request, reply) => {
      const userMessages = Array.isArray(request.body.content)
        ? request.body.content
        : [request.body.content];
      const source = request.body.source ?? 'text';
      const expectedMessageCount = request.body.expected_message_count;
      await runSseProxy(app, request, reply, {
        kind: 'turn',
        corsAllowedOrigins,
        load: () =>
          service.prepareStream(
            request.user.sub,
            request.params.id,
            source,
            expectedMessageCount,
          ),
        agent: (state, signal) =>
          opts.agent.streamTurn({ state, userMessages, signal }),
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
  corsAllowedOrigins: readonly string[];
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

  // We write directly to `reply.raw`, which bypasses Fastify's reply lifecycle
  // — including the @fastify/cors hook that would otherwise add CORS headers.
  // Echo allowed request origins manually so browsers don't block the SSE
  // response once the preflight OPTIONS has already succeeded.
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  const origin = request.headers.origin;
  if (
    typeof origin === 'string' &&
    origin.length > 0 &&
    isCorsOriginAllowed(origin, ctx.corsAllowedOrigins)
  ) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  }

  reply.raw.writeHead(200, headers);

  const abort = new AbortController();
  // Detect the client hanging up mid-stream via the RESPONSE's `close`
  // (it fires when the connection terminates before our own `end()`).
  // `request.raw`'s close is NOT a reliable disconnect signal here: once
  // the request body has been fully consumed, Node may never emit it for
  // a mid-response connection teardown — which left abandoned turns
  // running (and persisting) to completion.
  reply.raw.once('close', () => abort.abort());

  const writeEvent = (type: string, data: unknown) => {
    reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let finalState: AgentWireState | null = null;
    for await (const event of ctx.agent(session.stateSnapshot, abort.signal)) {
      if (event.type === 'message') {
        writeEvent('message', event.data);
      } else if (event.type === 'done') {
        // Clients rely on "connection closed before `done` ⇒ nothing was
        // persisted" (the voice worker aborts a stale turn by closing the
        // SSE and re-sends the messages in a new request). The abort signal
        // only cancels the upstream agent fetch — if generation had already
        // finished, we would land here and persist a turn the caller
        // abandoned, which the re-send then duplicates. So: if the client
        // is gone, drop the result instead of persisting it.
        if (abort.signal.aborted) {
          request.log.info(
            { kind: ctx.kind },
            'client disconnected before done; skipping persist',
          );
          return;
        }
        finalState = event.data.state;
        const persisted = await persist(event.data.state, event.data.messages ?? []);
        writeEvent('done', { state: event.data.state, session: persisted });
      }
    }
    if (!finalState && !abort.signal.aborted) {
      writeEvent('error', { message: 'Stream ended without done event' });
    }
  } catch (err) {
    request.log.error({ err, kind: ctx.kind }, 'SSE proxy failed');
    writeEvent('error', {
      message: err instanceof Error ? err.message : 'Stream failed',
      // Machine-readable code (e.g. TURN_CONFLICT) so streaming callers
      // can distinguish retryable persistence conflicts from hard errors.
      ...(err instanceof HttpError && err.code ? { code: err.code } : {}),
    });
  } finally {
    reply.raw.end();
  }
}
