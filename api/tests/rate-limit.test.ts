import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { perUserLimit } from '../src/plugins/rate-limit.js';
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
      const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).not.toBe(429);
    }
  });

  it('shares a message allowance across sessions and batch/stream endpoints, excluding internal voice', async () => {
    h = await buildTestApp({
      rateLimitEnabled: true, chatMessagesMax: 3, chatMessagesTimeWindow: '6 hours',
      voice: { enabled: false, internalKey: 'test-voice-key' },
    });
    const alice = await registerAndAuth(h.app, 'alice@example.com');
    const bob = await registerAndAuth(h.app, 'bob@example.com');
    const create = async (headers: Record<string, string>) => {
      const res = await h!.app.inject({ method: 'POST', url: '/v1/sessions', headers,
        payload: { simulation_slug: 'behavioral-interview-brenda' } });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().id as string;
    };
    const first = await create(alice.authHeader);
    const second = await create(alice.authHeader);
    const batch = await h.app.inject({ method: 'POST', url: `/v1/sessions/${first}/messages`,
      headers: alice.authHeader, payload: { content: ['one', 'two'] } });
    expect(batch.statusCode, batch.body).toBe(200);
    const streamed = await h.app.inject({ method: 'POST', url: `/v1/sessions/${second}/messages/stream`,
      headers: alice.authHeader, payload: { content: 'three' } });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.body).toContain('event: done');
    const calls = h.agent.callLog.length;
    for (const suffix of ['messages', 'messages/stream']) {
      const blocked = await h.app.inject({ method: 'POST', url: `/v1/sessions/${first}/${suffix}`,
        headers: alice.authHeader, payload: { content: 'four', source: 'voice' } });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ error: 'RATE_LIMITED', retryAfter: expect.any(Number) });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    }
    expect(h.agent.callLog).toHaveLength(calls);
    const voice = await h.app.inject({ method: 'POST', url: `/v1/internal/sessions/${first}/messages/stream`,
      headers: { 'x-internal-key': 'test-voice-key' }, payload: { content: 'spoken turn' } });
    expect(voice.statusCode, voice.body).toBe(200);
    expect(voice.body).toContain('event: done');
    const bobSession = await create(bob.authHeader);
    const other = await h.app.inject({ method: 'POST', url: `/v1/sessions/${bobSession}/messages`,
      headers: bob.authHeader, payload: { content: 'independent allowance' } });
    expect(other.statusCode).toBe(200);
  });

  it('renews the shared allowance when the configured window expires', async () => {
    h = await buildTestApp({ rateLimitEnabled: true, chatMessagesMax: 1, chatMessagesTimeWindow: '1 second' });
    const { authHeader } = await registerAndAuth(h.app);
    const created = await h.app.inject({ method: 'POST', url: '/v1/sessions', headers: authHeader,
      payload: { simulation_slug: 'behavioral-interview-brenda' } });
    const send = () => h!.app.inject({ method: 'POST', url: `/v1/sessions/${created.json().id}/messages`,
      headers: authHeader, payload: { content: 'hello' } });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await send()).statusCode).toBe(200);
  });

  it('disables the text allowance with RATE_LIMIT_ENABLED=false', async () => {
    h = await buildTestApp({ rateLimitEnabled: false, chatMessagesMax: 1 });
    const { authHeader } = await registerAndAuth(h.app);
    const created = await h.app.inject({ method: 'POST', url: '/v1/sessions', headers: authHeader,
      payload: { simulation_slug: 'behavioral-interview-brenda' } });
    for (let i = 0; i < 2; i++) {
      const sent = await h.app.inject({ method: 'POST', url: `/v1/sessions/${created.json().id}/messages`,
        headers: authHeader, payload: { content: 'hello' } });
      expect(sent.statusCode).toBe(200);
    }
  });

  it('rejects a batch larger than the allowance before calling the agent', async () => {
    h = await buildTestApp({ rateLimitEnabled: true, chatMessagesMax: 2 });
    const { authHeader } = await registerAndAuth(h.app);
    const created = await h.app.inject({ method: 'POST', url: '/v1/sessions', headers: authHeader,
      payload: { simulation_slug: 'behavioral-interview-brenda' } });
    const calls = h.agent.callLog.length;
    const rejected = await h.app.inject({ method: 'POST', url: `/v1/sessions/${created.json().id}/messages`,
      headers: authHeader, payload: { content: ['one', 'two', 'three'] } });
    expect(rejected.statusCode).toBe(429);
    expect(h.agent.callLog).toHaveLength(calls);
    const detail = await h.app.inject({ method: 'GET', url: `/v1/sessions/${created.json().id}`, headers: authHeader });
    expect(detail.json().messages).toHaveLength(created.json().messages.length);
  });

  it('enforces the global default and returns a RATE_LIMITED envelope', async () => {
    h = await buildTestApp({
      rateLimitEnabled: true,
      rateLimitGlobalMax: 3,
      rateLimitGlobalTimeWindow: '1 minute',
    });

    for (let i = 0; i < 3; i++) {
      const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).not.toBe(429);
    }

    const limited = await h.app.inject({ method: 'GET', url: '/v1/health' });
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

  it('enforces the global default on the root liveness probe', async () => {
    h = await buildTestApp({
      rateLimitEnabled: true,
      rateLimitGlobalMax: 3,
      rateLimitGlobalTimeWindow: '1 minute',
    });

    for (let i = 0; i < 3; i++) {
      const res = await h.app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }

    const limited = await h.app.inject({ method: 'GET', url: '/health' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'RATE_LIMITED' });
  });

  it('isolates per-email buckets on /auth/resend-verification', async () => {
    h = await buildTestApp({ rateLimitEnabled: true });

    // Per-mailbox policy is 3/hour: fire exactly 3, then the 4th is 429.
    // `resend-verification` is not captcha-gated (see auth.schema.ts).
    for (let i = 0; i < 3; i++) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/auth/resend-verification',
        payload: { email: 'victim@example.com' },
      });
      expect(res.statusCode).not.toBe(429);
    }

    const blocked = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/resend-verification',
      payload: { email: 'victim@example.com' },
    });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json() as { error: string };
    expect(body.error).toBe('RATE_LIMITED');

    // Different mailbox → different bucket, from the exact same IP.
    const other = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/resend-verification',
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
        url: '/v1/auth/me/password',
        headers: alice.authHeader,
        payload: { currentPassword: 'wrong-password', newPassword: 'new-password-123' },
      });
      expect(res.statusCode).not.toBe(429);
    }

    const blocked = await h.app.inject({
      method: 'PATCH',
      url: '/v1/auth/me/password',
      headers: alice.authHeader,
      payload: { currentPassword: 'super-secret-123', newPassword: 'another-password-789' },
    });
    expect(blocked.statusCode).toBe(429);

    // Bob's bucket is independent — his first request goes through.
    const bobRes = await h.app.inject({
      method: 'PATCH',
      url: '/v1/auth/me/password',
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
        url: '/v1/auth/login',
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
      url: '/v1/auth/login',
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

describe('perUserLimit', () => {
  it('keys a plugin bucket by user id, then by IP', () => {
    const policy = perUserLimit(4, '1 minute');
    expect(policy).toMatchObject({ max: 4, timeWindow: '1 minute' });
    expect(policy.keyGenerator({ user: { sub: 'user-1' } } as FastifyRequest)).toBe('user:user-1');
    expect(policy.keyGenerator({ ip: '203.0.113.5' } as FastifyRequest)).toBe('ip:203.0.113.5');
    expect(policy.keyGenerator({} as FastifyRequest)).toBe('ip:anon');
  });
});
