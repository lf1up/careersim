import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AgentClient } from '../../agent/client.js';
import type { AppDatabase } from '../../db/client.js';

interface HealthRouteOptions {
  db: AppDatabase;
  agent: AgentClient;
}

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'error']),
  agent: z.enum(['ok', 'error', 'skipped']),
});

export const healthRoutes: FastifyPluginAsyncZod<HealthRouteOptions> = async (app, opts) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness probe',
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
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
