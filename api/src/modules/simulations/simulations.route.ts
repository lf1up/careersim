import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AgentClient } from '../../agent/client.js';
import { AgentRequestError } from '../../agent/client.js';

interface SimulationsRouteOptions {
  agent: AgentClient;
}

const simulationSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  persona_name: z.string(),
  description: z.string().nullable().optional(),
  difficulty: z.number().int().nullable().optional(),
  estimated_duration_minutes: z.number().int().nullable().optional(),
  goal_count: z.number().int().nullable().optional(),
  skills_to_learn: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

const simulationsResponseSchema = z.object({
  simulations: z.array(simulationSummarySchema),
});

const simulationGoalSchema = z.object({
  goal_number: z.number().int(),
  title: z.string(),
  description: z.string(),
  key_behaviors: z.array(z.string()).default([]),
  success_indicators: z.array(z.string()).default([]),
  is_optional: z.boolean().default(false),
});

const simulationSuccessCriteriaSchema = z.object({
  communication: z.array(z.string()).default([]),
  problem_solving: z.array(z.string()).default([]),
  emotional: z.array(z.string()).default([]),
});

const simulationDetailSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  scenario: z.string(),
  objectives: z.array(z.string()).default([]),
  persona_name: z.string(),
  persona_role: z.string().nullable().optional(),
  persona_category: z.string().nullable().optional(),
  persona_difficulty_level: z.number().int().nullable().optional(),
  difficulty: z.number().int().nullable().optional(),
  estimated_duration_minutes: z.number().int().nullable().optional(),
  skills_to_learn: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  success_criteria: simulationSuccessCriteriaSchema,
  conversation_goals: z.array(simulationGoalSchema).default([]),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export const simulationsRoutes: FastifyPluginAsyncZod<SimulationsRouteOptions> = async (
  app,
  opts,
) => {
  // Simulation catalogue endpoints are PUBLIC: guests can browse the list
  // and detail pages before signing up. All write endpoints (sessions,
  // messages, nudges) still require `app.authenticate`.
  app.get(
    '/simulations',
    {
      schema: {
        tags: ['simulations'],
        summary: 'List available simulations (proxied from the agent)',
        response: { 200: simulationsResponseSchema },
      },
    },
    async () => {
      return opts.agent.listSimulations();
    },
  );

  app.get(
    '/simulations/:slug',
    {
      schema: {
        tags: ['simulations'],
        summary: 'Fetch full detail for a single simulation (proxied from the agent)',
        params: z.object({ slug: z.string().min(1) }),
        response: {
          200: simulationDetailSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      try {
        return await opts.agent.getSimulation(slug);
      } catch (err) {
        if (err instanceof AgentRequestError && err.status === 404) {
          return reply.code(404).send({
            error: 'simulation_not_found',
            message: `Simulation "${slug}" was not found.`,
          });
        }
        throw err;
      }
    },
  );
};
