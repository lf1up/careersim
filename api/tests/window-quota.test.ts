import { describe, expect, it } from 'vitest';
import { createMemoryWindowQuota } from '../src/modules/quotas/window-quota.js';

describe('atomic window quota', () => {
  it('rejects whole batches, reuses consumption for ceiling changes and isolates users', async () => {
    const quota = createMemoryWindowQuota();
    const args = { userId: 'alice', bucket: 'messages' as const, windowMs: 1000 };
    expect(await quota.consume({ ...args, count: 2, max: 3 })).toMatchObject({ allowed: true, used: 2 });
    expect(await quota.consume({ ...args, count: 2, max: 3 })).toMatchObject({ allowed: false, used: 2 });
    expect(await quota.read(args)).toMatchObject({ used: 2 });
    expect(await quota.consume({ ...args, count: 1, max: 1 })).toMatchObject({ allowed: false, used: 2 });
    expect(await quota.consume({ ...args, count: 1, max: 5 })).toMatchObject({ allowed: true, used: 3 });
    expect(await quota.consume({ ...args, userId: 'bob', count: 1, max: 1 })).toMatchObject({ allowed: true, used: 1 });
  });
  it('accepts exactly three concurrent requests and renews the window', async () => {
    let clock = 10;
    const quota = createMemoryWindowQuota({ now: () => clock });
    const args = { userId: 'alice', bucket: 'sessions' as const, windowMs: 1000, count: 1, max: 3 };
    const results = await Promise.all(Array.from({ length: 10 }, () => quota.consume(args)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    clock = 1010;
    expect(await quota.read(args)).toEqual({ used: 0, resetsAt: null });
    expect(await quota.consume(args)).toMatchObject({ allowed: true, used: 1 });
  });
});
