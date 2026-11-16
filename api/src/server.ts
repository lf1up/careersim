import { createRequire } from 'node:module';
import { isIP } from 'node:net';

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
import { and, eq } from 'drizzle-orm';
import { voiceMinuteUsage } from './db/schema.js';
import { createPolarProvider } from './modules/billing/polar.js';
import { createBillingSync } from './modules/billing/sync.js';
import { createBillingReconciler } from './modules/billing/reconcile.js';
import { createBillingService } from './modules/billing/billing.service.js';
import { billingRoutes } from './modules/billing/billing.route.js';
import { billingWebhookRoutes } from './modules/billing/webhook.route.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

import { loadEnv } from './config/env.js';
import { buildPlanCatalog, type BillingConfig } from './modules/billing/catalog.js';
import type { WindowQuota } from './modules/quotas/window-quota.js';
import type { Entitlement, PlanLimits, BillingUsage } from './modules/billing/billing.schema.js';
import { createEntitlementService } from './modules/billing/entitlements.js';
import type { BillingProvider } from './modules/billing/polar.js';

import type { AgentClient } from './agent/client.js';
import type { AppDatabase } from './db/client.js';
import { type ApiPlugin, assertPluginRegistry, simulationProviders } from './extensions/sdk.js';
import altchaPlugin, { altchaChallengeRoutes } from './plugins/altcha.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import mailerPlugin, { type MailMessage } from './plugins/mailer.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import { analyticsRoutes } from './modules/analytics/analytics.route.js';
import { authRoutes } from './modules/auth/auth.route.js';
import { healthRoutes, livenessRoutes } from './modules/health/health.route.js';
import { personasRoutes } from './modules/personas/personas.route.js';
import { sessionsRoutes } from './modules/sessions/sessions.route.js';
import { simulationsRoutes } from './modules/simulations/simulations.route.js';
import { voiceRoutes } from './modules/voice/voice.route.js';
import type { VoiceServiceConfig } from './modules/voice/voice.service.js';
import { isCorsOriginAllowed } from './utils/cors.js';
import { contactClientIp } from './utils/contact-client.js';

export interface BuildAppOptions {
  db: AppDatabase;
  billing?: { config: BillingConfig; provider?: BillingProvider; now?: () => Date };
  resolveEntitlements?: (userId: string) => Promise<Entitlement>;
  agent: AgentClient;
  jwtSecret: string;
  trustedProxies?: string[];
  clientIpSource?: 'socket' | 'digitalocean';
  jwtExpiresIn?: string;
  nodeEnv?: 'development' | 'test' | 'production';
  logger?: boolean | Record<string, unknown>;
  /**
   * Bare path segment (no slashes) versioned routes are served under —
   * service index, versioned health, docs, and internal worker routes
   * included. Comes from the `API_VERSION_PREFIX` env var, already
   * normalized by `loadEnv` ('1', 'v1', '/v1/' all → 'v1').
   * Empty/undefined means no prefix — the bare-container (cloud)
   * default; the local compose stack sets 'v1'.
   *
   * The process-level `GET /health` liveness probe is *not* prefixed;
   * it always lives at the app root.
   */
  versionPrefix?: string;
  /**
   * Public origin of the Next.js web app; used when building absolute
   * URLs in outbound email (magic-link login, password reset, email
   * confirmation links).
   */
  webAppUrl: string;
  cors?: {
    /** Empty means preserve wide-open CORS behavior. */
    allowedOrigins?: string[];
    /**
     * Policy when `allowedOrigins` is empty: true reflects any origin
     * (dev/test convenience), false denies all cross-origin browser
     * requests. Defaults to false (deny) so production fails closed.
     */
    allowAllWhenEmpty?: boolean;
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
    /** Shared text-message allowance; excludes internal voice turns. */
    chatMessagesMax?: number;
    chatMessagesTimeWindow?: string;
    quotaStore?: WindowQuota;
  };
  /**
   * Optional cache ping used by the versioned health probe. Tests inject
   * this to exercise `cache: ok | error` without a live Redis. Production
   * leaves it unset and the probe pings `app.redis` when present.
   */
  cache?: { ping: () => Promise<void> };
  /**
   * Optional voice-worker ping used by the versioned health probe. Tests
   * inject this; production wires it from `VOICE_WORKER_URL` when voice
   * mode is enabled.
   */
  voiceHealth?: { ping: () => Promise<void> };
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
  /**
   * Build-time plugins. Empty (the default) leaves every route and the
   * session-creation path unchanged. Each plugin's routes mount at
   * `{versionPrefix}/{plugin.id}`.
   */
  plugins?: ApiPlugin[];
  voice?: {
    enabled: boolean;
    livekitUrl: string;
    livekitApiKey: string;
    livekitApiSecret: string;
    dailyMinutesPerUser: number;
    activeCallStaleSeconds?: number;
    now?: () => Date;
    terminateRoom?: (room: string) => Promise<void>;
    internalKey: string;
  };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const plugins = opts.plugins ?? [];
  assertPluginRegistry(plugins);
  const providers = simulationProviders(plugins);
  const billingConfig: BillingConfig = opts.billing?.config ?? loadEnv({
    DATABASE_URL: 'postgres://unused/unused', AGENT_API_URL: 'http://localhost:8001',
    JWT_SECRET: opts.jwtSecret, ALTCHA_HMAC_KEY: opts.altcha.hmacKey,
    WEB_APP_URL: opts.webAppUrl,
    SESSIONS_CREATE_MAX: String(opts.rateLimit?.createSessionMax ?? 2),
    SESSIONS_CREATE_WINDOW: opts.rateLimit?.createSessionTimeWindow ?? '6 hours',
    CHAT_MESSAGES_MAX: String(opts.rateLimit?.chatMessagesMax ?? 350),
    CHAT_MESSAGES_WINDOW: opts.rateLimit?.chatMessagesTimeWindow ?? '6 hours',
    VOICE_DAILY_MINUTES_PER_USER: String(opts.voice?.dailyMinutesPerUser ?? 60),
  });
  const billingNow = opts.billing?.now ?? (() => new Date());
  const billingCatalog = buildPlanCatalog(billingConfig);
  const entitlementService = createEntitlementService({ db: opts.db, catalog: billingCatalog, now: billingNow });
  const resolveEntitlements = opts.resolveEntitlements ?? entitlementService.resolveEntitlements;

  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustedProxies ?? false,
  }).withTypeProvider<ZodTypeProvider>();
  const docsEnabled = (opts.nodeEnv ?? process.env.NODE_ENV ?? 'development') === 'development';
  // '' when unset — versioned routes then live at the root (/auth/...).
  // `GET /health` is always registered at the app root (see livenessRoutes).
  const routePrefix = opts.versionPrefix ? `/${opts.versionPrefix}` : '';

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorateRequest('rateLimitClientIp', null);
  app.addHook('onRequest', async (request, reply) => {
    // Only enable on App Platform, whose ingress sets this provider header.
    const providerIp = request.headers['do-connecting-ip'];
    if (opts.clientIpSource === 'digitalocean' && typeof providerIp === 'string' && isIP(providerIp)) {
      request.rateLimitClientIp = providerIp;
    }
    const value = request.headers['x-careersim-client'];
    const signature = request.headers['x-careersim-client-signature'];
    if (value === undefined && signature === undefined) return;
    request.rateLimitClientIp = contactClientIp(value, signature, opts.altcha.hmacKey);
    if (!request.rateLimitClientIp) {
      return reply.code(400).send({ error: 'INVALID_PROXY_IDENTITY', message: 'Invalid contact proxy identity' });
    }
  });

  registerErrorHandler(app);

  const corsAllowedOrigins = opts.cors?.allowedOrigins ?? [];
  const corsAllowAllWhenEmpty = opts.cors?.allowAllWhenEmpty ?? false;
  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      // No Origin header = same-origin or non-browser client; CORS doesn't apply.
      if (!origin) return cb(null, true);
      cb(null, isCorsOriginAllowed(origin, corsAllowedOrigins, corsAllowAllWhenEmpty));
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
    chatMessagesMax: opts.rateLimit?.chatMessagesMax,
    chatMessagesTimeWindow: opts.rateLimit?.chatMessagesTimeWindow,
    resolveEntitlements,
    quotaStore: opts.rateLimit?.quotaStore,
  });

  const billingProvider = opts.billing?.provider ?? createPolarProvider(billingConfig);
  const { syncCustomer } = createBillingSync({ db: opts.db, config: billingConfig, provider: billingProvider, now: billingNow });
  const billingService = createBillingService({
    db: opts.db, config: billingConfig, catalog: billingCatalog, provider: billingProvider,
    syncCustomer, resolveEntitlements, now: billingNow,
    async readUsage(userId: string, limits: PlanLimits): Promise<BillingUsage> {
      const results = await Promise.allSettled([
        app.windowQuota.read({ userId, bucket: 'sessions', windowMs: limits.sessionsWindowMs }),
        app.windowQuota.read({ userId, bucket: 'messages', windowMs: limits.chatWindowMs }),
        Promise.all(plugins.flatMap(plugin => plugin.usage ? [plugin.usage(userId)] : [])),
        opts.db.select().from(voiceMinuteUsage).where(and(eq(voiceMinuteUsage.userId, userId),
          eq(voiceMinuteUsage.usageDate, billingNow().toISOString().slice(0, 10)))),
      ]);
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') app.log.warn({ source: ['sessions', 'messages', 'inventory', 'voice'][index] }, 'billing usage unavailable');
      }
      const [sessionResult, messageResult, inventoryResult, voiceResult] = results;
      const sessionUsage = sessionResult.status === 'fulfilled' ? sessionResult.value : null;
      const messageUsage = messageResult.status === 'fulfilled' ? messageResult.value : null;
      const inventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value[0] : null;
      const voiceRows = voiceResult.status === 'fulfilled' ? voiceResult.value : null;
      const resetAt = new Date(billingNow());
      resetAt.setUTCHours(24, 0, 0, 0);
      return {
        sessions: sessionUsage ? { used: sessionUsage.used, limit: limits.sessionsCreateMax, resetAt: sessionUsage.resetsAt?.toISOString() ?? null } : null,
        chatMessages: messageUsage ? { used: messageUsage.used, limit: limits.chatMessagesMax, resetAt: messageUsage.resetsAt?.toISOString() ?? null } : null,
        customSimulations: inventory ? { used: inventory.customSimulations, limit: limits.customSimulationsMax, resetAt: null } : null,
        customPersonas: inventory ? { used: inventory.customPersonas, limit: limits.customPersonasMax, resetAt: null } : null,
        voice: voiceRows ? { used: (voiceRows[0]?.secondsUsed ?? 0) / 60, limit: limits.voiceDailyMinutes, resetAt: resetAt.toISOString() } : null,
      };
    },
  });
  // Continue processing existing billing state even when new checkout is disabled.
  if (billingConfig.POLAR_ACCESS_TOKEN || opts.billing?.provider) {
    const reconciler = createBillingReconciler({ db: opts.db, syncCustomer });
    const stop = reconciler.start({ onResult: result => {
      if (result.failed) app.log.warn(result, 'billing reconciliation failures');
    } });
    app.addHook('onClose', async () => { stop(); });
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CareerSIM API',
        description: 'Fastify + Drizzle API gateway in front of the CareerSIM agent.',
        version: pkg.version,
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
  await registerAuth(app, {
    db: opts.db,
    secret: opts.jwtSecret,
    expiresIn: opts.jwtExpiresIn ?? '7d',
  });

  await app.register(mailerPlugin, {
    from: opts.mail.from,
    smtp: opts.mail.smtp,
    devFallback: opts.mail.devFallback,
    outbox: opts.mail.outbox,
    nodeEnv: opts.nodeEnv,
  });

  await app.register(altchaPlugin, {
    db: opts.db,
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
        resolveEntitlements,
        now: opts.voice.now,
        terminateRoom: opts.voice.terminateRoom,
        // Pass through as-is: `undefined` lets the service default to
        // the token TTL; `0` is an explicit "disable the guard" escape
        // hatch (nothing is ever considered an active call).
        ...(opts.voice.activeCallStaleSeconds !== undefined
          ? { activeCallStaleSeconds: opts.voice.activeCallStaleSeconds }
          : {}),
      }
    : {
        enabled: false,
        livekitUrl: '',
        livekitApiKey: '',
        livekitApiSecret: '',
        dailyMinutesPerUser: 0,
      };
  // Voice mode is useless without the shared internal key: the
  // agent-voice worker calls back into the internal routes to read the
  // budget and report usage, and those routes 503 when the key is
  // blank. Fail fast at startup rather than letting a misconfigured
  // deployment accept calls that can never complete.
  const internalKey = opts.voice?.internalKey ?? '';
  if (voiceConfig.enabled && !internalKey) {
    throw new Error(
      'Voice mode is enabled but AGENT_INTERNAL_KEY is empty. ' +
        'Set a matching internal key on the API and the agent-voice worker, ' +
        'or disable voice mode (VOICE_ENABLED=false).',
    );
  }

  // ---------------------------------------------------------------------
  // Process liveness always lives at the app root (`GET /health`) so
  // probes don't need to know `API_VERSION_PREFIX`. The versioned
  // surface — service index, readiness `/health`, docs, and the
  // internal worker<->API voice routes — lives under the version
  // prefix. Unset means unprefixed versioned routes (the
  // bare-container / cloud default); compose + .env set `v1` locally.
  //
  // When the prefix is empty, the versioned readiness probe would
  // collide with root liveness, so we skip registering it and `/health`
  // is the process check only.
  //
  // NOTE: fp()-wrapped plugins (altcha, mailer, rate-limit, auth) break
  // encapsulation and MUST NOT define routes, or they'd escape this
  // prefix. Their routes live in standalone plugins registered here
  // (see `altchaChallengeRoutes`).
  // ---------------------------------------------------------------------
  await app.register(livenessRoutes);

  await app.register(
    async (scope) => {
      if (docsEnabled) {
        // Serve the OpenAPI JSON + a Swagger UI page loaded from CDN.
        // We do NOT use @fastify/swagger-ui: at @fastify/swagger-ui@5.2.5 +
        // @fastify/static@9.1.1 its internal nested-prefix registration 404s on all
        // static assets (swagger-ui.css, swagger-ui-bundle.js, favicons, logo, etc.).
        // See the note in README.md for the minimal repro.
        scope.get('/docs/openapi.json', { schema: { hide: true } }, async () => app.swagger());
        scope.get(
          '/docs',
          { schema: { tags: ['meta'], summary: 'Swagger UI' } },
          async (_req, reply) => {
            reply.type('text/html').send(renderSwaggerUiHtml(`${routePrefix}/docs/openapi.json`));
          },
        );
      }

      scope.withTypeProvider<ZodTypeProvider>().get(
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
            health: `${routePrefix}/health`,
            uptimeSeconds: Math.floor(process.uptime()),
          };
          return docsEnabled ? { ...body, docs: `${routePrefix}/docs` } : body;
        },
      );

      // Versioned readiness (`GET {prefix}/health`) — skipped when the
      // prefix is empty so it doesn't collide with root liveness.
      if (routePrefix) {
        const redis = app.redis;
        await scope.register(healthRoutes, {
          db: opts.db,
          agent: opts.agent,
          cache:
            opts.cache ??
            (redis
              ? {
                  ping: async () => {
                    if (redis.status !== 'ready') {
                      throw new Error(`redis status ${redis.status}`);
                    }
                    await redis.ping();
                  },
                }
              : undefined),
          voice: opts.voiceHealth,
        });
      }
      await scope.register(altchaChallengeRoutes);
      await scope.register(authRoutes, {
        db: opts.db,
        webAppUrl: opts.webAppUrl,
        mailProductName: opts.mail.productName,
        nodeEnv: opts.nodeEnv,
        jwtExpiresIn: opts.jwtExpiresIn ?? '7d',
      });
      await scope.register(billingRoutes, { service: billingService, catalog: billingCatalog });
      await scope.register(billingWebhookRoutes, { db: opts.db, secret: billingConfig.POLAR_WEBHOOK_SECRET, syncCustomer });
      await scope.register(simulationsRoutes, { agent: opts.agent, simulationProviders: providers });
      await scope.register(personasRoutes, { agent: opts.agent });
      await scope.register(sessionsRoutes, {
        db: opts.db,
        agent: opts.agent,
        simulationProviders: providers,
        corsAllowedOrigins,
        corsAllowAllWhenEmpty,
        internalKey,
      });
      for (const plugin of plugins) {
        if (!plugin.routes) continue;
        await scope.register(
          async (pluginScope) => {
            await plugin.routes!(pluginScope, {
              db: opts.db,
              agent: opts.agent,
              authenticate: pluginScope.authenticate,
              logger: pluginScope.log,
              resolveEntitlements,
            });
          },
          { prefix: `/${plugin.id}` },
        );
      }
      await scope.register(analyticsRoutes, { db: opts.db });
      await scope.register(voiceRoutes, {
        db: opts.db,
        config: voiceConfig,
        internalKey,
      });
    },
    routePrefix ? { prefix: routePrefix } : {},
  );

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
