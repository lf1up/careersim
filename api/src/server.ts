import { createRequire } from 'node:module';

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

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
  // Serve the OpenAPI JSON + a Swagger UI page loaded from CDN.
  // We do NOT use @fastify/swagger-ui: at @fastify/swagger-ui@5.2.5 +
  // @fastify/static@9.1.1 its internal nested-prefix registration 404s on all
  // static assets (swagger-ui.css, swagger-ui-bundle.js, favicons, logo, etc.).
  // See the note in README.md for the minimal repro.
  app.get('/docs/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  app.get('/docs', { schema: { tags: ['meta'], summary: 'Swagger UI' } }, async (_req, reply) => {
    reply.type('text/html').send(renderSwaggerUiHtml('/docs/openapi.json'));
  });

  await registerAuth(app, {
    secret: opts.jwtSecret,
    expiresIn: opts.jwtExpiresIn ?? '7d',
  });

  app.withTypeProvider<ZodTypeProvider>().get(
    '/',
    {
      schema: {
        tags: ['meta'],
        summary: 'Service index',
        description:
          'Returns basic service metadata and pointers to the health probe and OpenAPI docs.',
        response: {
          200: z.object({
            name: z.string(),
            version: z.string(),
            status: z.literal('ok'),
            docs: z.string(),
            health: z.string(),
            uptimeSeconds: z.number().int().nonnegative(),
          }),
        },
      },
    },
    async () => ({
      name: pkg.name,
      version: pkg.version,
      status: 'ok' as const,
      docs: '/docs',
      health: '/health',
      uptimeSeconds: Math.floor(process.uptime()),
    }),
  );

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

/**
 * Minimal Swagger UI page that fetches its CSS/JS from jsDelivr. Kept as a
 * function (rather than a static string) so `specUrl` can be parameterized
 * and we can iterate on the CSP / pinned version in one place.
 */
function renderSwaggerUiHtml(specUrl: string): string {
  const uiVersion = '5.17.14';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>CareerSim API — Swagger UI</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${uiVersion}/swagger-ui.css" />
    <link rel="icon" type="image/png" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${uiVersion}/favicon-32x32.png" sizes="32x32" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${uiVersion}/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
      });
    </script>
  </body>
</html>`;
}
