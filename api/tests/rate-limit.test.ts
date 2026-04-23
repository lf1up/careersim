import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, registerAndAuth, TEST_ALTCHA, type TestHarness } from './helpers/build-test-app.js';

/**
 * @fastify/rate-limit uses the `retry-after` header (seconds, HTTP
 * standard) and emits a JSON body shaped by the `errorResponseBuilder`
 * in `src/plugins/rate-limit.ts`. Tests below pin both.
 */

describe('rate limiting', () => {
  let h: TestHarness | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it('lets the whole suite through when disabled', async () => {
    h = await buildTestApp({
      rateLimitEnabled: false,
      // Deliberately tight — if the plugin ever leaks through with the
      // disabled flag set, this would fire a 429.
      rateLimitGlobalMax: 1,
      rateLimitGlobalTimeWindow: '1 minute',
    });

    for (let i = 0; i < 10; i++) {
      const res = await h.app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).not.toBe(429);
    }
  });

  it('enforces the global default and returns a RATE_LIMITED envelope', async () => {
    h = await buildTestApp({
      rateLimitEnabled: true,
      rateLimitGlobalMax: 3,
      rateLimitGlobalTimeWindow: '1 minute',
    });

    for (let i = 0; i < 3; i++) {
      const res = await h.app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).not.toBe(429);
    }

    const limited = await h.app.inject({ method: 'GET', url: '/health' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['x-ratelimit-limit']).toBeDefined();
    expect(limited.headers['x-ratelimit-remaining']).toBe('0');

    const body = limited.json() as { error: string; message: string; retryAfter: number };
    expect(body.error).toBe('RATE_LIMITED');
    expect(body.message).toMatch(/too many requests/i);
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('isolates per-email buckets on /auth/resend-verification', async () => {
    h = await buildTestApp({ rateLimitEnabled: true });

    // Per-mailbox policy is 3/hour: fire exactly 3, then the 4th is 429.
    // `resend-verification` is not captcha-gated (see auth.schema.ts).
    for (let i = 0; i < 3; i++) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/resend-verification',
        payload: { email: 'victim@example.com' },
      });
      expect(res.statusCode).not.toBe(429);
    }

    const blocked = await h.app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'victim@example.com' },
    });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json() as { error: string };
    expect(body.error).toBe('RATE_LIMITED');

    // Different mailbox → different bucket, from the exact same IP.
    const other = await h.app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'someone-else@example.com' },
    });
    expect(other.statusCode).not.toBe(429);
  });

  it('isolates per-user buckets on /auth/me/password', async () => {
    h = await buildTestApp({ rateLimitEnabled: true });

    const alice = await registerAndAuth(h.app, 'alice@example.com', 'super-secret-123');
    const bob = await registerAndAuth(h.app, 'bob@example.com', 'super-secret-456');

    // Policy is 10/hour per user — burn through Alice's bucket with
    // deliberately-wrong current-password attempts (the route still
    // counts failed requests against the limiter, which is the point).
    for (let i = 0; i < 10; i++) {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/auth/me/password',
        headers: alice.authHeader,
        payload: { currentPassword: 'wrong-password', newPassword: 'new-password-123' },
      });
      expect(res.statusCode).not.toBe(429);
    }

    const blocked = await h.app.inject({
      method: 'PATCH',
      url: '/auth/me/password',
      headers: alice.authHeader,
      payload: { currentPassword: 'super-secret-123', newPassword: 'another-password-789' },
    });
    expect(blocked.statusCode).toBe(429);

    // Bob's bucket is independent — his first request goes through.
    const bobRes = await h.app.inject({
      method: 'PATCH',
      url: '/auth/me/password',
      headers: bob.authHeader,
      payload: { currentPassword: 'super-secret-456', newPassword: 'bobs-new-password-xyz' },
    });
    expect(bobRes.statusCode).not.toBe(429);
    // And it succeeds with correct credentials.
    expect(bobRes.statusCode).toBe(200);
  });

  it('applies the /auth/login per-IP burst limit (10/min)', async () => {
    h = await buildTestApp({ rateLimitEnabled: true });

    // Unknown account: the service throws 401 on every attempt, but the
    // limiter counts 4xx too — 11th attempt flips to 429.
    for (let i = 0; i < 10; i++) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: `noone-${i}@example.com`,
          password: 'wrong-wrong-wrong',
          altcha: TEST_ALTCHA,
        },
      });
      expect(res.statusCode).not.toBe(429);
    }

    const limited = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'noone-tripwire@example.com',
        password: 'wrong-wrong-wrong',
        altcha: TEST_ALTCHA,
      },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
