import { Readable } from 'node:stream';

import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AgentClient } from '../../agent/client.js';
import { AgentRequestError } from '../../agent/client.js';

interface PersonasRouteOptions {
  agent: AgentClient;
}

const personaSchema = z.object({
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  category: z.string(),
  difficulty_level: z.number().int().nonnegative(),
  avatar_url: z.string().nullable().optional(),
});

const personasResponseSchema = z.object({
  personas: z.array(personaSchema),
});

const personaAvatarParamsSchema = z.object({
  slug: z.string().min(1),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
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

  app.get(
    '/personas/:slug/avatar',
    {
      schema: {
        tags: ['personas'],
        summary: 'Fetch a persona avatar PNG (proxied from the agent)',
        params: personaAvatarParamsSchema,
        response: {
          200: z.any(),
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      try {
        const upstream = await opts.agent.getPersonaAvatar({
          slug,
        });
        copyHeader(reply, upstream.headers, 'content-type');
        copyHeader(reply, upstream.headers, 'content-length');
        copyHeader(reply, upstream.headers, 'etag');
        copyHeader(reply, upstream.headers, 'last-modified');
        copyHeader(reply, upstream.headers, 'cache-control');
        return reply.send(Readable.from(upstream.body));
      } catch (err) {
        if (err instanceof AgentRequestError && err.status === 404) {
          return reply.code(404).send({
            error: 'avatar_not_found',
            message: `No avatar found for persona "${slug}".`,
          });
        }
        throw err;
      }
    },
  );
};

function copyHeader(
  reply: FastifyReply,
  headers: Record<string, string | string[] | undefined>,
  key: string,
): void {
  const value = headers[key];
  if (value !== undefined) {
    reply.header(key, value);
  }
}
