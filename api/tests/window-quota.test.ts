import { describe, expect, it } from 'vitest';
import { createMemoryWindowQuota, createWindowQuota, quotaWindowMs } from '../src/modules/quotas/window-quota.js';

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

describe('quota window configuration', () => {
  it.each([
    ['250ms', 250], ['2 milliseconds', 2], ['1s', 1000], ['2 seconds', 2000],
    ['1.5 m', 90000], ['2 minutes', 120000], ['1h', 3600000], [' 2 HOURS ', 7200000],
    ['1d', 86400000], ['2 days', 172800000],
  ])('converts %s to a millisecond expiry', (duration, expected) => {
    expect(quotaWindowMs(String(duration))).toBe(expected);
  });
  it.each(['0 seconds', '-1h', '1 month', 'tomorrow', '0.001ms', '9007199254740992ms'])('rejects unusable quota duration %s', duration => {
    expect(() => quotaWindowMs(duration)).toThrow('Invalid quota window');
  });
  it.each([null, [1, 2], ['1', 2, 1000]])('rejects a malformed Redis quota response %j', async result => {
    const quota = createWindowQuota({ redis: { eval: async () => result } });
    await expect(quota.consume({ userId: 'alice', bucket: 'messages', windowMs: 1000, count: 1, max: 3 }))
      .rejects.toThrow('Invalid quota store response');
  });
});
