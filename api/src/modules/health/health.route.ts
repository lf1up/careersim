import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AgentClient } from '../../agent/client.js';
import type { AppDatabase } from '../../db/client.js';

interface HealthRouteOptions {
  db: AppDatabase;
  agent: AgentClient;
}

const livenessResponseSchema = z.object({
  status: z.literal('ok'),
});

const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'error']),
  agent: z.enum(['ok', 'error', 'skipped']),
});

/**
 * Process-level liveness probe, always mounted at the app root (`GET /health`)
 * so load balancers and k8s probes don't need to know `API_VERSION_PREFIX`.
 * Does not ping the database or agent — a hung dependency must not flap the
 * process itself. Use the versioned `/v1/health` (or `{prefix}/health`) for
 * a readiness check of that API version.
 */
export const livenessRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Process liveness probe',
        description:
          'Cheap process-level check. Does not ping the database or agent. Use the versioned `/health` under `API_VERSION_PREFIX` (e.g. `/v1/health`) for a readiness probe of that API version.',
        response: { 200: livenessResponseSchema },
      },
    },
    async () => ({ status: 'ok' as const }),
  );
};

/**
 * Version-scoped readiness probe (`GET {prefix}/health`). Pings Postgres and
 * the agent so callers can tell whether *this* API version can serve traffic.
 */
export const healthRoutes: FastifyPluginAsyncZod<HealthRouteOptions> = async (app, opts) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Version readiness probe',
        description:
          'Pings the database and agent for this API version. Returns 503 when either dependency is down. For a process-only check, use the unprefixed `GET /health`.',
        response: { 200: readinessResponseSchema, 503: readinessResponseSchema },
      },
    },
    async (_request, reply) => {
      let dbStatus: 'ok' | 'error' = 'ok';
      try {
        await opts.db.execute(sql`select 1`);
      } catch {
        dbStatus = 'error';
      }

      let agentStatus: 'ok' | 'error' = 'ok';
      try {
        await opts.agent.health();
      } catch {
        agentStatus = 'error';
      }

      const overall: 'ok' | 'degraded' =
        dbStatus === 'ok' && agentStatus === 'ok' ? 'ok' : 'degraded';
      reply.code(overall === 'ok' ? 200 : 503);
      return { status: overall, db: dbStatus, agent: agentStatus };
    },
  );
};
