import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { AppDatabase } from '../../db/client.js';
import { createAnalyticsService } from './analytics.service.js';
import { analyticsOverviewSchema } from './analytics.schema.js';

interface AnalyticsRouteOptions {
  db: AppDatabase;
}

export const analyticsRoutes: FastifyPluginAsyncZod<AnalyticsRouteOptions> = async (
  app,
  opts,
) => {
  const service = createAnalyticsService(opts.db);

  app.get(
    '/analytics/overview',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['analytics'],
        summary: "Aggregate the caller's practice stats across all sessions",
        description:
          'Deterministic stats (sessions, goals, completion rate, practice time) cover every session; skill averages, score trend, and tone distribution only cover sessions with a cached debrief report — `reports.analyzed_sessions` tells clients how much coverage they have.',
        security: [{ bearerAuth: [] }],
        response: { 200: analyticsOverviewSchema },
      },
    },
    async (request) => {
      return service.overview(request.user.sub);
    },
  );
};
