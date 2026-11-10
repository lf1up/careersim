import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import fp from 'fastify-plugin';

import { HttpError } from './errors.js';
import type { Entitlement } from '../modules/billing/billing.schema.js';
import { createMemoryWindowQuota, createWindowQuota, quotaWindowMs, type WindowQuota, type QuotaBucket } from '../modules/quotas/window-quota.js';

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

/** Verified contact/provider identity first; otherwise use the configured socket/proxy IP. */
const byIp: RateLimitKeyGenerator = (req) => req.rateLimitClientIp ?? req.ip ?? 'anon';

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

/**
 * Key by the `:id` (session) route param. Used by the internal
 * worker<->API voice routes, which authenticate via `X-Internal-Key`
 * (no `req.user`) and are all called by the single agent-voice worker
 * IP. Keying by IP there would force every session through one shared
 * bucket; keying by session bounds per-session abuse (e.g. a leaked
 * internal key hammering one session) without throttling the worker
 * across unrelated concurrent calls. Falls back to IP for safety.
 */
const bySessionParam: RateLimitKeyGenerator = (req) => {
  const params = (req.params ?? {}) as Record<string, unknown>;
  const id = typeof params.id === 'string' ? params.id : '';
  return id ? `vsession:${id}` : `ip:${byIp(req)}`;
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
 * Per-user bucket that shares this process's rate-limit store (Redis when
 * configured, otherwise the in-memory LRU) and the host 429 envelope.
 * Plugins attach the result to a route's `config.rateLimit`.
 */
export function perUserLimit(max: number, timeWindow: string): RouteRateLimit {
  return limit(max, timeWindow, byUser);
}

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
  /** Separate churn protection; never write the legacy six-hour allowance key. */
  createSession: () =>
    limit(10, '1 minute', (req) => `session-burst:${byUser(req)}`),
  sendMessage: () => limit(60, '1 minute', byUser),
  proactive: () => limit(30, '1 minute', byUser),
  nudge: () => limit(120, '1 minute', byUser),
  /**
   * Debrief report fetch. Cache hits are cheap, but a cache miss burns a
   * (large-context) LLM call on the agent — and a client can force misses
   * by alternating messages with report requests. Cap well below
   * `sendMessage` so report generation can never dominate LLM spend.
   */
  sessionReport: () => limit(10, '5 minutes', byUser),
  /**
   * Voice-call start. Each call mints a LiveKit join token and burns a
   * room slot on the SFU; we cap legitimate users to a few starts per
   * minute so a runaway client (or a genuine attacker) can't churn
   * tokens and exhaust the room budget. The hard daily ceiling lives
   * in `voice_minute_usage` — this is just churn protection.
   */
  voiceStart: () => limit(10, '1 minute', byUser),
  /**
   * Voice-call end (user-facing). Only flips the single-active-call
   * marker — cheap — but a couple of these fire per call (explicit End
   * plus the client's disconnect self-heal), so we allow a bit more
   * headroom than `voiceStart` while still capping churn. Keyed by user.
   */
  voiceEnd: () => limit(20, '1 minute', byUser),
  /**
   * Internal worker<->API voice routes (`state-for-voice`,
   * `voice-budget`, authoritative `voice/end`). Behind `X-Internal-Key`
   * and called only by the agent-voice worker, so this is a damage-cap
   * for a leaked key / runaway worker rather than a user-facing limit.
   * Keyed PER SESSION (see `bySessionParam`) — a single call makes ~3
   * internal requests total, so 30/min/session is generous while still
   * bounding abuse against any one session.
   */
  voiceInternal: () => limit(30, '1 minute', bySessionParam),
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
   * These defaults apply when no host entitlement resolver is supplied.
   */
  createSessionMax?: number;
  createSessionTimeWindow?: string;
  /** One allowance per user shared by all text-message routes. */
  chatMessagesMax?: number;
  chatMessagesTimeWindow?: string;
  resolveEntitlements?: (userId: string) => Promise<Entitlement>;
  quotaStore?: WindowQuota;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Attach after authentication and body validation on text-message routes only. */
    checkTextMessageQuota: preHandlerAsyncHookHandler;
    checkSessionQuota: preHandlerAsyncHookHandler;
    windowQuota: WindowQuota;
    /**
     * Marker decorator so tests (and future route authors) can quickly
     * verify the plugin is active. The policies themselves are imported
     * directly from this module as a typed table.
     */
    rateLimitEnabled: boolean;
    /**
     * Shared Redis client used as the rate-limit store. `null` when the
     * plugin is disabled or `REDIS_URL` is unset (in-memory LRU). The
     * versioned health probe pings this when present.
     */
    redis: Redis | null;
  }
}

export default fp<RateLimitOptions>(
  async (app, opts) => {
    const enabled = opts.enabled !== false;
    app.decorate('rateLimitEnabled', enabled);

    if (!enabled) {
      app.decorate('checkTextMessageQuota', async () => {});
      app.decorate('checkSessionQuota', async () => {});
      app.decorate('windowQuota', opts.quotaStore ?? createMemoryWindowQuota());
      app.decorate('redis', null);
      app.log.info('rate-limit plugin disabled (RATE_LIMIT_ENABLED=false)');
      return;
    }

    let redis: Redis | null = null;
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
    app.decorate('redis', redis);

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
      // If `redis` is null the plugin uses its built-in LRU store,
      // which is exactly what we want in single-instance / dev.
      redis: redis ?? undefined,
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

    const quota = opts.quotaStore ?? (redis ? createWindowQuota({ redis }) : createMemoryWindowQuota());
    app.decorate('windowQuota', quota);
    function checkQuota(bucket: QuotaBucket): preHandlerAsyncHookHandler {
      return async (request, reply) => {
        const userId = request.user.sub;
        const entitlement = await opts.resolveEntitlements?.(userId);
        const max = bucket === 'sessions'
          ? entitlement?.limits.sessionsCreateMax ?? opts.createSessionMax ?? 2
          : entitlement?.limits.chatMessagesMax ?? opts.chatMessagesMax ?? 350;
        const windowMs = bucket === 'sessions'
          ? entitlement?.limits.sessionsWindowMs ?? quotaWindowMs(opts.createSessionTimeWindow ?? '6 hours')
          : entitlement?.limits.chatWindowMs ?? quotaWindowMs(opts.chatMessagesTimeWindow ?? '6 hours');
        const content = bucket === 'messages' ? (request.body as { content: string | string[] }).content : '';
        const count = bucket === 'messages' && Array.isArray(content) ? content.length : 1;
        let decision;
        try {
          decision = await quota.consume({ userId, bucket, count, max, windowMs });
        } catch (err) {
          request.log.error({ err, bucket }, 'quota storage unavailable');
          throw new HttpError(503, 'Usage limits are temporarily unavailable. Please retry.', 'QUOTA_UNAVAILABLE', { retryAfter: 1000 });
        }
        if (!decision.allowed) {
          const retryAfter = Math.max(1, decision.resetsAt.getTime() - Date.now());
          reply.header('retry-after', Math.ceil(retryAfter / 1000));
          reply.header('x-ratelimit-limit', max);
          reply.header('x-ratelimit-remaining', decision.remaining);
          reply.header('x-ratelimit-reset', Math.ceil(retryAfter / 1000));
          throw new HttpError(429, bucket === 'sessions' ? 'Session limit reached. Please try again later.' : 'Text message limit reached. Please try again later.',
            'RATE_LIMITED', { retryAfter, quotaKind: bucket, tier: entitlement?.tier ?? 'free', used: decision.used, max,
              resetsAt: decision.resetsAt.toISOString(), contactUrl: '/contact' });
        }
      };
    }
    app.decorate('checkTextMessageQuota', checkQuota('messages'));
    app.decorate('checkSessionQuota', checkQuota('sessions'));
  },
  { name: 'rate-limit' },
);
