import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWindowQuota } from '../src/modules/quotas/window-quota.js';
import { buildTestApp, registerAndAuth } from './helpers/build-test-app.js';

// Explicit disposable database; never FLUSHDB. Only this run's UUID keys are deleted.
const url = process.env.QUOTA_TEST_REDIS_URL;
describe.skipIf(!url)('window quota with two real Redis clients', () => {
  let first: Redis;
  let second: Redis;
  const userId = `quota-test-${randomUUID()}`;
  const keys = [
    `quota:messages:user:${userId}`, `quota:sessions:user:${userId}`,
    `quota:messages:user:${userId}-other`,
    `fastify-rate-limit-undefinedundefined-text-messages:user:${userId}`,
    `fastify-rate-limit-POST/v1/sessions-user:${userId}`,
  ];
  beforeAll(async () => {
    first = new Redis(url!, { keyPrefix: 'careersim:rl:', maxRetriesPerRequest: 1 });
    second = new Redis(url!, { keyPrefix: 'careersim:rl:', maxRetriesPerRequest: 1 });
    await Promise.all([first.ping(), second.ping()]);
  });
  afterAll(async () => {
    if (first) { await first.del(...keys); await first.quit(); }
    if (second) await second.quit();
  });
  it('serializes concurrency, batches and tier changes on the same counters', async () => {
    const a = createWindowQuota({ redis: first });
    const b = createWindowQuota({ redis: second });
    const args = { userId, bucket: 'messages' as const, windowMs: 60_000 };
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).consume({ ...args, count: 1, max: 3 })));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(await a.consume({ ...args, count: 3, max: 5 })).toMatchObject({ allowed: false, used: 3 });
    expect(await b.read(args)).toMatchObject({ used: 3 });
    expect(await b.consume({ ...args, count: 2, max: 5 })).toMatchObject({ allowed: true, used: 5 });
    expect(await a.consume({ ...args, count: 1, max: 2 })).toMatchObject({ allowed: false, used: 5 });
    expect(await b.read(args)).toMatchObject({ used: 5 });
    expect(await a.consume({ ...args, userId: `${userId}-other`, count: 1, max: 1 })).toMatchObject({ allowed: true, used: 1 });
  });
  it('retains the current legacy Free consumption and original expiry', async () => {
    await first.del(`quota:messages:user:${userId}`);
    await first.set(keys[3]!, 2, 'PX', 5000);
    const quota = createWindowQuota({ redis: second });
    const args = { userId, bucket: 'messages' as const, windowMs: 60_000 };
    expect(await quota.read(args)).toMatchObject({ used: 2 });
    expect(await quota.consume({ ...args, count: 2, max: 3 })).toMatchObject({ allowed: false, used: 2 });
    expect(await first.pttl(keys[0]!)).toBeLessThanOrEqual(5000);
  });
  it('does not reuse a legacy six-hour session allowance as the new minute burst counter', async () => {
    const h = await buildTestApp({ rateLimitEnabled: true, redisUrl: url, createSessionMax: 100 });
    let ownedKeys: string[] = [];
    try {
      const auth = await registerAndAuth(h.app, `${randomUUID()}@example.com`);
      const legacy = `fastify-rate-limit-POST/v1/sessions-user:${auth.userId}`;
      const stable = `quota:sessions:user:${auth.userId}`;
      const burst = `fastify-rate-limit-POST/v1/sessions-session-burst:user:${auth.userId}`;
      ownedKeys = [legacy, stable, burst];
      await first.set(legacy, 9, 'PX', 21_600_000);
      for (let i = 0; i < 2; i++) {
        const response = await h.app.inject({ method: 'POST', url: '/v1/sessions', headers: auth.authHeader,
          payload: { simulation_slug: 'behavioral-interview-brenda' } });
        expect(response.statusCode, response.body).toBe(201);
      }
      expect(await first.get(legacy)).toBe('9');
      expect(await first.get(stable)).toBe('11');
      expect(await first.get(burst)).toBe('2');
    } finally {
      await h.close();
      if (ownedKeys.length) await first.del(...ownedKeys);
    }
  });
  it('blocks expensive work with 503 when the real quota client is disconnected', async () => {
    const h = await buildTestApp({ rateLimitEnabled: true, redisUrl: url });
    try {
      const auth = await registerAndAuth(h.app, `${randomUUID()}@example.com`);
      expect(h.app.redis).not.toBeNull();
      h.app.redis?.disconnect();
      const calls = h.agent.callLog.length;
      const response = await h.app.inject({ method: 'POST', url: '/v1/sessions', headers: auth.authHeader,
        payload: { simulation_slug: 'behavioral-interview-brenda' } });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json()).toMatchObject({ error: 'QUOTA_UNAVAILABLE' });
      expect(h.agent.callLog).toHaveLength(calls);
    } finally {
      await h.close();
    }
  });
  it('resets after expiry without extending on rejection', async () => {
    const quota = createWindowQuota({ redis: first });
    const args = { userId, bucket: 'sessions' as const, windowMs: 40, count: 1, max: 1 };
    expect(await quota.consume(args)).toMatchObject({ allowed: true, used: 1 });
    expect(await quota.consume(args)).toMatchObject({ allowed: false, used: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await quota.read(args)).toEqual({ used: 0, resetsAt: null });
    expect(await quota.consume(args)).toMatchObject({ allowed: true, used: 1 });
  });
});
