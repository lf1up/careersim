import type { FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import fp from 'fastify-plugin';

import { HttpError } from './errors.js';

/**
 * Rate-limiting policy.
 *
 * We pair ALTCHA (per-request cost) with `@fastify/rate-limit` (sustained
 * request ceilings) and argon2id (credential brute-force defence) to form
 * the three layers of abuse protection on the public auth surface.
 *
 * The plugin exposes:
 *   - a global default (200/min per IP) as a safety net
 *   - `app.rateLimit.policy[name]` factories that routes attach via the
 *     per-route `config.rateLimit` option
 *
 * Each factory returns a config object with the right `max`, `timeWindow`,
 * and a `keyGenerator` that resolves the abuse axis we care about (IP,
 * email from the body, or authenticated user id).
 */

// -- Keyers -----------------------------------------------------------

type RateLimitKeyGenerator = (req: FastifyRequest) => string;

/** Best-effort client IP. Honours `X-Forwarded-For` when `trustProxy` is on. */
const byIp: RateLimitKeyGenerator = (req) => req.ip ?? 'anon';

/**
 * Key by the (lowercased) `email` field in the JSON body, falling back to
 * IP so malformed requests still hit *some* bucket. Used for endpoints
 * that fan out an email; attackers should not be able to amplify against a
 * single mailbox by rotating source IPs.
 */
const byEmail: RateLimitKeyGenerator = (req) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  return email ? `email:${email}` : `ip:${byIp(req)}`;
};

/**
 * Key by the authenticated user id. The route MUST run `app.authenticate`
 * via `onRequest` before the rate-limit hook fires, otherwise `req.user`
 * is undefined and we degrade to IP.
 */
const byUser: RateLimitKeyGenerator = (req) => {
  const sub = (req.user as { sub?: string } | undefined)?.sub;
  return sub ? `user:${sub}` : `ip:${byIp(req)}`;
};

// -- Policy catalogue --------------------------------------------------

export interface RouteRateLimit {
  max: number;
  timeWindow: string;
  keyGenerator: RateLimitKeyGenerator;
}

/**
 * Shorthand: build a `config.rateLimit` value with the right keyer.
 * Kept in a single place so the policy table is scannable in one pass.
 */
function limit(
  max: number,
  timeWindow: string,
  keyGenerator: RateLimitKeyGenerator,
): RouteRateLimit {
  return { max, timeWindow, keyGenerator };
}

/**
 * Mutable config for per-route policies that ops can tune without
 * touching code. Route factories below read from this object at
 * registration time, so the rate-limit plugin can override defaults
 * from env vars during `register()` before any route runs.
 *
 * Only the knobs we actually want configurable live here — the rest of
 * the policy table is intentionally hard-coded so the limits stay
 * reviewable in one place.
 */
const policyConfig = {
  createSession: {
    // Each session spins up an agent thread and burns LLM tokens, so we
    // keep new-session creation aggressively capped by default. Bumped
    // to 2/6h from an earlier 30/1h once we moved to hosted inference.
    max: 2,
    timeWindow: '6 hours',
  },
};

export const rateLimitPolicy = {
  // Public auth — brute-force and spam sensitive. The IP axis is also
  // covered by the plugin's global 200/min default, so per-route entries
  // focus on whichever dimension (email/IP) the endpoint actually
  // amplifies against.
  authChallenge: () => limit(60, '1 minute', byIp),
  register: () => limit(10, '15 minutes', byIp),
  login: () => limit(10, '1 minute', byIp),
  verifyCode: () => limit(10, '5 minutes', byEmail),
  consumeToken: () => limit(10, '5 minutes', byIp),
  resetPassword: () => limit(10, '5 minutes', byIp),
  /** Mail-bomb defence: one mailbox can receive at most 3 per hour. */
  emailSendByMailbox: () => limit(3, '1 hour', byEmail),
  /** Magic-link is a bit more permissive — users retry more naturally. */
  emailLinkByMailbox: () => limit(5, '1 hour', byEmail),

  // Authenticated profile + session mutations — keyed by user so shared
  // egress IPs (offices, VPNs) don't punish one another.
  changePassword: () => limit(10, '1 hour', byUser),
  requestEmailChange: () => limit(5, '1 hour', byUser),
  confirmEmailChange: () => limit(10, '5 minutes', byUser),
  /**
   * Env-configurable via `SESSIONS_CREATE_MAX` / `SESSIONS_CREATE_WINDOW`.
   * Defaults to 2 per 6 hours per user — see `policyConfig.createSession`.
   */
  createSession: () =>
    limit(policyConfig.createSession.max, policyConfig.createSession.timeWindow, byUser),
  sendMessage: () => limit(60, '1 minute', byUser),
  proactive: () => limit(30, '1 minute', byUser),
  nudge: () => limit(120, '1 minute', byUser),
} as const;

export type RateLimitPolicyName = keyof typeof rateLimitPolicy;

// -- Plugin ------------------------------------------------------------

export interface RateLimitOptions {
  /**
   * Master on/off switch. When false, the plugin is a no-op — routes
   * still carry their per-route config but no 429 is ever produced.
   * Defaults to true.
   */
  enabled?: boolean;
  /**
   * Optional Redis connection string. When omitted (or when the plugin
   * is disabled) we use `@fastify/rate-limit`'s in-memory LRU store,
   * which is appropriate for a single-instance deploy or local dev.
   */
  redisUrl?: string;
  /**
   * Global default: applied to *every* route that doesn't override it.
   * Defaults to 200 requests per minute per IP.
   */
  globalMax?: number;
  globalTimeWindow?: string;
  /**
   * Overrides for per-route policies that are exposed via env vars.
   * See `policyConfig` in this file for the set of tunable limits.
   */
  createSessionMax?: number;
  createSessionTimeWindow?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Marker decorator so tests (and future route authors) can quickly
     * verify the plugin is active. The policies themselves are imported
     * directly from this module as a typed table.
     */
    rateLimitEnabled: boolean;
  }
}

export default fp<RateLimitOptions>(
  async (app, opts) => {
    const enabled = opts.enabled !== false;
    app.decorate('rateLimitEnabled', enabled);

    // Apply env-driven overrides to the policy table *before* routes
    // register, so their `config.rateLimit` factories pick up the new
    // values. This runs even when `enabled` is false so the policy table
    // stays consistent for tests that toggle the flag on later.
    if (typeof opts.createSessionMax === 'number') {
      policyConfig.createSession.max = opts.createSessionMax;
    }
    if (typeof opts.createSessionTimeWindow === 'string' && opts.createSessionTimeWindow.length > 0) {
      policyConfig.createSession.timeWindow = opts.createSessionTimeWindow;
    }

    if (!enabled) {
      app.log.info('rate-limit plugin disabled (RATE_LIMIT_ENABLED=false)');
      return;
    }

    let redis: Redis | undefined;
    if (opts.redisUrl) {
      // Eager connect (no `lazyConnect`) so the socket handshake happens
      // alongside the rest of app startup — by the time we accept the
      // first request the stream is writable. `maxRetriesPerRequest: 1`
      // fails fast under a Redis outage so a dead cache doesn't balloon
      // request latency; `skipOnError: true` below then treats that
      // failure as "allow" (fail-open), matching what you want out of a
      // sustained-request ceiling.
      redis = new Redis(opts.redisUrl, {
        maxRetriesPerRequest: 1,
        // `keyPrefix` namespaces all buckets so the rate limiter can
        // share a Redis instance with other CareerSim features without
        // colliding.
        keyPrefix: 'careersim:rl:',
      });
      redis.on('error', (err: Error) => {
        // `skipOnError: true` (see below) means the plugin will allow
        // this request through rather than 500. We log at warn so the
        // outage is observable without spamming error dashboards.
        app.log.warn({ err }, 'rate-limit: redis error, allowing request (fail-open)');
      });

      app.addHook('onClose', async () => {
        try {
          await redis?.quit();
        } catch {
          // Best-effort — nothing to do if Redis was already closed.
        }
      });

      app.log.info('rate-limit: using Redis store');
    } else {
      app.log.info('rate-limit: using in-memory LRU store (REDIS_URL not set)');
    }

    await app.register(rateLimit, {
      global: true,
      max: opts.globalMax ?? 200,
      timeWindow: opts.globalTimeWindow ?? '1 minute',
      // Run rate-limiting after body parsing so keyers like `byEmail`
      // can read the (validated-shape) JSON body. The default
      // `onRequest` stage runs too early for that.
      hook: 'preHandler',
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
      // Fail-open: if the configured store (Redis) throws — e.g. the
      // cache is down or the network is flaky — allow the request
      // through rather than 500. Availability of auth/chat beats
      // perfect rate-limit precision during an infra incident.
      skipOnError: true,
      // If `redis` is undefined the plugin uses its built-in LRU store,
      // which is exactly what we want in single-instance / dev.
      redis,
      keyGenerator: byIp,
      // Re-shape 429 responses to match our `{ error, message, retryAfter }`
      // envelope. `context.after` is a human-readable duration like "30s";
      // `context.ttl` is the milliseconds-to-refill window. We return an
      // {@link HttpError} so the central error handler in `errors.ts`
      // serializes it with the right status code + standard envelope.
      errorResponseBuilder: (_req, context) =>
        new HttpError(
          context.statusCode ?? 429,
          `Too many requests. Try again in ${context.after}.`,
          'RATE_LIMITED',
          { retryAfter: context.ttl },
        ),
    });
  },
  { name: 'rate-limit' },
);
