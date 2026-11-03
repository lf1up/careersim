import { createChallenge, verifySolution } from 'altcha-lib/v1';
import fp from 'fastify-plugin';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { lte } from 'drizzle-orm';

import type { AppDatabase } from '../db/client.js';
import { usedCaptchaChallenges } from '../db/schema.js';

import { badRequest } from './errors.js';
import { rateLimitPolicy } from './rate-limit.js';

const challengeResponseSchema = z.object({
  algorithm: z.string(),
  challenge: z.string(),
  salt: z.string(),
  signature: z.string(),
  maxnumber: z.number().optional(),
});

/**
 * Magic bypass token accepted only when `bypass: true` is passed to the
 * plugin (default off). Enables the Vitest suite to submit a fixed string
 * instead of solving a real proof-of-work challenge for every request.
 *
 * NEVER enable bypass mode in production — the token would let any caller
 * trivially skip CAPTCHA.
 */
export const ALTCHA_TEST_BYPASS_TOKEN = 'test-bypass';

export interface AltchaOptions {
  db: AppDatabase;
  /** HMAC secret used to sign + verify challenges. */
  hmacKey: string;
  /**
   * Upper bound for the random PoW target. Higher values = slower solve
   * time. 50_000 is a reasonable default for interactive auth flows.
   */
  maxNumber?: number;
  /**
   * When true, `altcha.verify()` accepts {@link ALTCHA_TEST_BYPASS_TOKEN}
   * in place of a real payload. Used exclusively by the test harness.
   */
  bypass?: boolean;
  /** Lifetime of an issued challenge. Defaults to 10 minutes. */
  expiresInMs?: number;
}

export interface AltchaVerifier {
  /**
   * Validate a payload submitted alongside a sensitive auth request.
   *
   * Throws a 400 `CAPTCHA_REQUIRED` / `CAPTCHA_INVALID` if the payload is
   * missing or does not pass verification.
   */
  verify(payload: string | null | undefined): Promise<void>;
  /**
   * Issue a fresh signed proof-of-work challenge. Exposed on the
   * decorator so the `/auth/challenge` route can live outside this
   * fp() plugin (fp breaks encapsulation, so a route defined here
   * would ignore the `/v1` prefix applied at registration).
   */
  issueChallenge(): Promise<z.infer<typeof challengeResponseSchema>>;
}

declare module 'fastify' {
  interface FastifyInstance {
    altcha: AltchaVerifier;
  }
}

export default fp<AltchaOptions>(
  async (app, opts) => {
    if (!opts.hmacKey) {
      throw new Error('altcha plugin: hmacKey is required');
    }
    const maxNumber = opts.maxNumber ?? 50_000;
    const expiresInMs = opts.expiresInMs ?? 10 * 60 * 1000;
    const bypass = Boolean(opts.bypass);

    const verifier: AltchaVerifier = {
      async verify(payload) {
        // In bypass mode, accept either an omitted payload or the fixed
        // test token. Anything else still runs through the real verifier,
        // so tests that want to exercise the "invalid payload" branch can
        // do so without spinning up a second app.
        if (bypass && (payload == null || payload === ALTCHA_TEST_BYPASS_TOKEN)) {
          return;
        }
        if (!payload) {
          throw badRequest('CAPTCHA verification is required', 'CAPTCHA_REQUIRED');
        }
        let ok = false;
        try {
          ok = await verifySolution(payload, opts.hmacKey, true);
        } catch {
          ok = false;
        }
        if (!ok) {
          throw badRequest('CAPTCHA verification failed', 'CAPTCHA_INVALID');
        }
        const solved = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { challenge: string; salt: string };
        const expires = Number(new URLSearchParams(solved.salt.split('?')[1]).get('expires'));
        if (!Number.isFinite(expires) || expires * 1000 <= Date.now()) {
          throw badRequest('CAPTCHA verification failed', 'CAPTCHA_INVALID');
        }
        await opts.db.delete(usedCaptchaChallenges).where(lte(usedCaptchaChallenges.expiresAt, new Date()));
        // The unique key arbitrates concurrent attempts across all API instances.
        const claimed = await opts.db.insert(usedCaptchaChallenges)
          .values({ challenge: solved.challenge, expiresAt: new Date(expires * 1000) })
          .onConflictDoNothing().returning();
        if (!claimed.length) throw badRequest('CAPTCHA verification failed', 'CAPTCHA_INVALID');
      },
      async issueChallenge() {
        const challenge = await createChallenge({
          hmacKey: opts.hmacKey,
          maxNumber,
          expires: new Date(Date.now() + expiresInMs),
        });
        return challenge as z.infer<typeof challengeResponseSchema>;
      },
    };

    app.decorate('altcha', verifier);
  },
  { name: 'altcha' },
);

/**
 * `GET /auth/challenge` as a standalone (non-fp) route plugin so it
 * respects the version prefix of the scope it's registered in. Must be
 * registered after the altcha fp plugin above (it uses `app.altcha`).
 */
export const altchaChallengeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/auth/challenge/verify', {
    config: { rateLimit: rateLimitPolicy.authChallenge() },
    schema: {
      tags: ['auth'],
      summary: 'Consume a single-use CAPTCHA solution for server-side contact forms',
      body: z.object({ altcha: z.string().min(1).max(4096) }),
      response: { 200: z.object({ ok: z.literal(true) }) },
    },
  }, async (request) => {
    await app.altcha.verify(request.body.altcha);
    return { ok: true as const };
  });
  app.get(
    '/auth/challenge',
    {
      config: { rateLimit: rateLimitPolicy.authChallenge() },
      schema: {
        tags: ['auth'],
        summary: 'Issue an ALTCHA proof-of-work challenge',
        description:
          'Client (altcha-widget) fetches this endpoint to obtain a fresh ' +
          'signed challenge. The widget solves it locally and returns the ' +
          'resulting payload in a form field named "altcha", which the ' +
          'caller must include when invoking sensitive auth endpoints.',
        response: { 200: challengeResponseSchema },
      },
    },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return app.altcha.issueChallenge();
    },
  );
};
