import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { AgentClient } from './agent/client.js';
import type { AppDatabase } from './db/client.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import { authRoutes } from './modules/auth/auth.route.js';
import { healthRoutes } from './modules/health/health.route.js';
import { sessionsRoutes } from './modules/sessions/sessions.route.js';
import { simulationsRoutes } from './modules/simulations/simulations.route.js';

export interface BuildAppOptions {
  db: AppDatabase;
  agent: AgentClient;
  jwtSecret: string;
  jwtExpiresIn?: string;
  logger?: boolean | Record<string, unknown>;
  nudge?: {
    minIdleSeconds: number;
    maxPerSilence: number;
  };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CareerSim API',
        description: 'Fastify + Drizzle API gateway in front of the CareerSim agent.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await registerAuth(app, {
    secret: opts.jwtSecret,
    expiresIn: opts.jwtExpiresIn ?? '7d',
  });

  await app.register(healthRoutes, { db: opts.db, agent: opts.agent });
  await app.register(authRoutes, { db: opts.db });
  await app.register(simulationsRoutes, { agent: opts.agent });
  await app.register(sessionsRoutes, {
    db: opts.db,
    agent: opts.agent,
    nudge: opts.nudge ?? { minIdleSeconds: 60, maxPerSilence: 2 },
  });

  return app;
}
