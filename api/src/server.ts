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
import altchaPlugin from './plugins/altcha.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import mailerPlugin, { type MailMessage } from './plugins/mailer.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import { authRoutes } from './modules/auth/auth.route.js';
import { healthRoutes } from './modules/health/health.route.js';
import { personasRoutes } from './modules/personas/personas.route.js';
import { sessionsRoutes } from './modules/sessions/sessions.route.js';
import { simulationsRoutes } from './modules/simulations/simulations.route.js';
import { voiceRoutes } from './modules/voice/voice.route.js';
import type { VoiceServiceConfig } from './modules/voice/voice.service.js';
import { isCorsOriginAllowed } from './utils/cors.js';

export interface BuildAppOptions {
  db: AppDatabase;
  agent: AgentClient;
  jwtSecret: string;
  jwtExpiresIn?: string;
  nodeEnv?: 'development' | 'test' | 'production';
  logger?: boolean | Record<string, unknown>;
  /**
   * Public origin of the Next.js web app; used when building absolute
   * URLs in outbound email (magic-link login, password reset, email
   * confirmation links).
   */
  webAppUrl: string;
  cors?: {
    /** Empty means preserve wide-open CORS behavior. */
    allowedOrigins?: string[];
  };
  mail: {
    from: string;
    productName: string;
    smtp?: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
    };
    /** Force the stdout-only transport (tests / dev without SMTP). */
    devFallback?: boolean;
    outbox?: MailMessage[];
  };
  altcha: {
    hmacKey: string;
    maxNumber?: number;
    /**
     * When true, `app.altcha.verify()` accepts the test bypass token.
     * Only enable in the Vitest harness.
     */
    bypass?: boolean;
  };
  rateLimit?: {
    /**
     * Master on/off switch for `@fastify/rate-limit`. Defaults to true;
     * the test harness flips it to false so the suite doesn't have to
     * reason about buckets.
     */
    enabled?: boolean;
    /**
     * Optional Redis URL. When omitted, the plugin falls back to an
     * in-memory LRU store (per-process). Use Redis for multi-instance
     * deployments where buckets need to be shared.
     */
    redisUrl?: string;
    /** Override the global safety-net limit (default 200/min per IP). */
    globalMax?: number;
    globalTimeWindow?: string;
    /**
     * Override the per-user session-creation cap (default 2 per 6 hours).
     * Exposed as env vars `SESSIONS_CREATE_MAX` / `SESSIONS_CREATE_WINDOW`
     * so ops can tune quota without a code change.
     */
    createSessionMax?: number;
    createSessionTimeWindow?: string;
  };
  /**
   * Voice mode (browser-native LiveKit + chained pipeline).
   *
   * Routes register unconditionally — the OpenAPI surface stays
   * stable across deployments — but each route returns 503
   * `voice_disabled` when `enabled` is false. That way ops can flip
   * the kill switch without redeploying the API container.
   *
   * `internalKey` is the shared secret the agent-voice worker sends
   * on `/internal/sessions/:id/state-for-voice`; we reuse
   * `AGENT_INTERNAL_KEY` so there's only one secret to rotate.
   */
  voice?: {
    enabled: boolean;
    livekitUrl: string;
    livekitApiKey: string;
    livekitApiSecret: string;
    dailyMinutesPerUser: number;
    internalKey: string;
  };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
  }).withTypeProvider<ZodTypeProvider>();
  const docsEnabled = (opts.nodeEnv ?? process.env.NODE_ENV ?? 'development') === 'development';

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  const corsAllowedOrigins = opts.cors?.allowedOrigins ?? [];
  await app.register(cors, {
    credentials: true,
    origin:
      corsAllowedOrigins.length === 0
        ? true
        : (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
            cb(null, !origin || isCorsOriginAllowed(origin, corsAllowedOrigins));
          },
  });
  await app.register(sensible);

  // Rate limiting must be registered before route plugins so the global
  // default attaches to all routes (and per-route configs can override
  // it). When disabled it's a no-op; when enabled the 429 response
  // shape is wired up in the plugin itself.
  await app.register(rateLimitPlugin, {
    enabled: opts.rateLimit?.enabled,
    redisUrl: opts.rateLimit?.redisUrl,
    globalMax: opts.rateLimit?.globalMax,
    globalTimeWindow: opts.rateLimit?.globalTimeWindow,
    createSessionMax: opts.rateLimit?.createSessionMax,
    createSessionTimeWindow: opts.rateLimit?.createSessionTimeWindow,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CareerSIM API',
        description: 'Fastify + Drizzle API gateway in front of the CareerSIM agent.',
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
  if (docsEnabled) {
    // Serve the OpenAPI JSON + a Swagger UI page loaded from CDN.
    // We do NOT use @fastify/swagger-ui: at @fastify/swagger-ui@5.2.5 +
    // @fastify/static@9.1.1 its internal nested-prefix registration 404s on all
    // static assets (swagger-ui.css, swagger-ui-bundle.js, favicons, logo, etc.).
    // See the note in README.md for the minimal repro.
    app.get('/docs/openapi.json', { schema: { hide: true } }, async () => app.swagger());
    app.get('/docs', { schema: { tags: ['meta'], summary: 'Swagger UI' } }, async (_req, reply) => {
      reply.type('text/html').send(renderSwaggerUiHtml('/docs/openapi.json'));
    });
  }

  await registerAuth(app, {
    secret: opts.jwtSecret,
    expiresIn: opts.jwtExpiresIn ?? '7d',
  });

  await app.register(mailerPlugin, {
    from: opts.mail.from,
    smtp: opts.mail.smtp,
    devFallback: opts.mail.devFallback,
    outbox: opts.mail.outbox,
  });

  await app.register(altchaPlugin, {
    hmacKey: opts.altcha.hmacKey,
    maxNumber: opts.altcha.maxNumber,
    bypass: opts.altcha.bypass,
  });

  const serviceIndexResponse = docsEnabled
    ? z.object({
        name: z.string(),
        version: z.string(),
        status: z.literal('ok'),
        agent: z.enum(['ok', 'error']),
        docs: z.string(),
        health: z.string(),
        uptimeSeconds: z.number().int().nonnegative(),
      })
    : z.object({
        name: z.string(),
        version: z.string(),
        status: z.literal('ok'),
        agent: z.enum(['ok', 'error']),
        health: z.string(),
        uptimeSeconds: z.number().int().nonnegative(),
      });

  app.withTypeProvider<ZodTypeProvider>().get(
    '/',
    {
      schema: {
        tags: ['meta'],
        summary: 'Service index',
        description: docsEnabled
          ? 'Returns basic service metadata and pointers to the health probe and OpenAPI docs.'
          : 'Returns basic service metadata and a pointer to the health probe.',
        response: {
          200: serviceIndexResponse,
        },
      },
    },
    async () => {
      let agentStatus: 'ok' | 'error' = 'ok';
      try {
        await opts.agent.health();
      } catch {
        agentStatus = 'error';
      }

      const body = {
        name: pkg.name,
        version: pkg.version,
        status: 'ok' as const,
        agent: agentStatus,
        health: '/health',
        uptimeSeconds: Math.floor(process.uptime()),
      };
      return docsEnabled ? { ...body, docs: '/docs' } : body;
    },
  );

  await app.register(healthRoutes, { db: opts.db, agent: opts.agent });
  await app.register(authRoutes, {
    db: opts.db,
    webAppUrl: opts.webAppUrl,
    mailProductName: opts.mail.productName,
  });
  await app.register(simulationsRoutes, { agent: opts.agent });
  await app.register(personasRoutes, { agent: opts.agent });
  await app.register(sessionsRoutes, {
    db: opts.db,
    agent: opts.agent,
    corsAllowedOrigins,
  });

  // Voice routes always register; the kill switch lives inside the
  // service layer so the OpenAPI surface stays consistent. When the
  // caller doesn't pass a `voice` block (older bootstrap, tests that
  // opt out) we synthesize a disabled config so the routes 503.
  const voiceConfig: VoiceServiceConfig = opts.voice
    ? {
        enabled: opts.voice.enabled,
        livekitUrl: opts.voice.livekitUrl,
        livekitApiKey: opts.voice.livekitApiKey,
        livekitApiSecret: opts.voice.livekitApiSecret,
        dailyMinutesPerUser: opts.voice.dailyMinutesPerUser,
      }
    : {
        enabled: false,
        livekitUrl: '',
        livekitApiKey: '',
        livekitApiSecret: '',
        dailyMinutesPerUser: 0,
      };
  await app.register(voiceRoutes, {
    db: opts.db,
    config: voiceConfig,
    internalKey: opts.voice?.internalKey ?? '',
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
    <title>CareerSIM API — Swagger UI</title>
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
