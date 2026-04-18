import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AgentClient } from '../../agent/client.js';

interface SimulationsRouteOptions {
  agent: AgentClient;
}

const simulationSchema = z.object({
  slug: z.string(),
  title: z.string(),
  persona_name: z.string(),
});

const simulationsResponseSchema = z.object({
  simulations: z.array(simulationSchema),
});

export const simulationsRoutes: FastifyPluginAsyncZod<SimulationsRouteOptions> = async (
  app,
  opts,
) => {
  app.get(
    '/simulations',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['simulations'],
        summary: 'List available simulations (proxied from the agent)',
        security: [{ bearerAuth: [] }],
        response: { 200: simulationsResponseSchema },
      },
    },
    async () => {
      return opts.agent.listSimulations();
    },
  );
};
