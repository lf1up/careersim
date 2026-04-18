import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AgentClient } from '../../agent/client.js';

interface PersonasRouteOptions {
  agent: AgentClient;
}

const personaSchema = z.object({
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  category: z.string(),
  difficulty_level: z.number().int().nonnegative(),
});

const personasResponseSchema = z.object({
  personas: z.array(personaSchema),
});

export const personasRoutes: FastifyPluginAsyncZod<PersonasRouteOptions> = async (app, opts) => {
  app.get(
    '/personas',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['personas'],
        summary: 'List available personas (proxied from the agent)',
        description:
          'Returns a public-safe summary for each persona. Internal roleplay fields ' +
          '(personality, primaryGoal, hiddenMotivation, conversationStyle) are stripped ' +
          'at the agent so they cannot leak through this proxy.',
        security: [{ bearerAuth: [] }],
        response: { 200: personasResponseSchema },
      },
    },
    async () => {
      return opts.agent.listPersonas();
    },
  );
};
