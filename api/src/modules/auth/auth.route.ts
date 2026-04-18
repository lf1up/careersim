import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AppDatabase } from '../../db/client.js';
import { badRequest } from '../../plugins/errors.js';
import { createAuthService } from './auth.service.js';
import {
  authResponseSchema,
  credentialsSchema,
  meResponseSchema,
} from './auth.schema.js';

interface AuthRouteOptions {
  db: AppDatabase;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, opts) => {
  const service = createAuthService(opts.db);

  app.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create a new user account',
        body: credentialsSchema,
        response: { 201: authResponseSchema },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const user = await service.register(email, password);
      const token = await reply.jwtSign({ sub: user.id, email: user.email });
      reply.code(201).send({
        token,
        user: { id: user.id, email: user.email },
      });
    },
  );

  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for a JWT',
        body: credentialsSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const user = await service.verifyCredentials(email, password);
      if (!user) throw badRequest('Invalid email or password', 'INVALID_CREDENTIALS');
      const token = await reply.jwtSign({ sub: user.id, email: user.email });
      return {
        token,
        user: { id: user.id, email: user.email },
      };
    },
  );

  app.get(
    '/auth/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Return the current user',
        security: [{ bearerAuth: [] }],
        response: {
          200: meResponseSchema,
          404: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const user = await service.findById(request.user.sub);
      if (!user) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'User not found' };
      }
      return { id: user.id, email: user.email };
    },
  );
};
