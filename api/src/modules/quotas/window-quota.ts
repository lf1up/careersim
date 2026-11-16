import type { Redis } from 'ioredis';

export type QuotaBucket = 'sessions' | 'messages';
export interface QuotaWindow {
  userId: string;
  bucket: QuotaBucket;
  windowMs: number;
}
export interface QuotaDecision {
  allowed: boolean;
  used: number;
  remaining: number;
  resetsAt: Date;
}
export interface WindowQuota {
  consume(args: QuotaWindow & { count: number; max: number }): Promise<QuotaDecision>;
  read(args: QuotaWindow): Promise<{ used: number; resetsAt: Date | null }>;
}

type Clock = () => number | Date;
const timestamp = (now: Clock): number => Number(now());

// Read, legacy migration, complete-batch admission, increment and expiry are one
// operation. Neither a rejected batch nor a changed ceiling extends the window.
const WINDOW_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  used = 0
  ttl = 0
  for i = 2, #KEYS do
    local legacyTtl = redis.call('PTTL', KEYS[i])
    local legacyUsed = tonumber(redis.call('GET', KEYS[i]) or '0')
    if legacyTtl > 0 then
      used = math.max(used, legacyUsed)
      ttl = math.max(ttl, legacyTtl)
    end
  end
  if ttl > 0 then redis.call('SET', KEYS[1], used, 'PX', ttl) end
end
local count = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
if count == 0 then return {1, used, ttl} end
if used + count > max then return {0, used, math.max(ttl, window * (ttl == 0 and 1 or 0))} end
if ttl <= 0 then ttl = window end
used = used + count
redis.call('SET', KEYS[1], used, 'PX', ttl)
return {1, used, ttl}
`;

/** Uses a Redis client whose keyPrefix is careersim:rl:, matching the old store. */
export function createWindowQuota({ redis, now = Date.now }: { redis: Pick<Redis, 'eval'>; now?: Clock }): WindowQuota {
  function keys(args: QuotaWindow): string[] {
    const stable = `quota:${args.bucket}:user:${args.userId}`;
    return args.bucket === 'messages'
      ? [stable, `fastify-rate-limit-undefinedundefined-text-messages:user:${args.userId}`]
      : [stable, ...['/v1/sessions', '/sessions'].map((path) => `fastify-rate-limit-POST${path}-user:${args.userId}`)];
  }
  async function run(args: QuotaWindow, count: number, max: number) {
    const bucketKeys = keys(args);
    const result = await redis.eval(WINDOW_SCRIPT, bucketKeys.length, ...bucketKeys, count, max, args.windowMs);
    if (!Array.isArray(result) || result.length !== 3 || !result.every((value) => typeof value === 'number')) {
      throw new Error('Invalid quota store response');
    }
    const [allowed = 0, used = 0, ttl = 0] = result;
    return { allowed: allowed === 1, used, ttl };
  }
  return {
    async consume(args) {
      const { allowed, used, ttl } = await run(args, args.count, args.max);
      return { allowed, used, remaining: Math.max(0, args.max - used), resetsAt: new Date(timestamp(now) + ttl) };
    },
    async read(args) {
      const { used, ttl } = await run(args, 0, 0);
      return { used, resetsAt: ttl > 0 ? new Date(timestamp(now) + ttl) : null };
    },
  };
}

/** Single-process development/test store; mutation happens before the first await. */
export function createMemoryWindowQuota({ now = Date.now }: { now?: Clock } = {}): WindowQuota {
  const windows = new Map<string, { used: number; resetsAt: number }>();
  function current(args: QuotaWindow) {
    const key = `${args.bucket}:${args.userId}`;
    const value = windows.get(key);
    if (value && value.resetsAt > timestamp(now)) return { key, value };
    windows.delete(key);
    return { key, value: undefined };
  }
  return {
    async consume(args) {
      const { key, value } = current(args);
      const used = value?.used ?? 0;
      const resetsAt = value?.resetsAt ?? timestamp(now) + args.windowMs;
      const allowed = used + args.count <= args.max;
      const next = allowed ? used + args.count : used;
      if (allowed) windows.set(key, { used: next, resetsAt });
      return { allowed, used: next, remaining: Math.max(0, args.max - next), resetsAt: new Date(resetsAt) };
    },
    async read(args) {
      const { value } = current(args);
      return { used: value?.used ?? 0, resetsAt: value ? new Date(value.resetsAt) : null };
    },
  };
}

/** Parse the duration syntax accepted by our configured window settings. */
export function quotaWindowMs(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|s|minutes?|m|hours?|h|days?|d)\s*$/i.exec(value);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid quota window: ${value}`);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'ms' || unit.startsWith('millisecond') ? 1
    : unit === 's' || unit.startsWith('second') ? 1000
      : unit === 'm' || unit.startsWith('minute') ? 60_000
        : unit === 'h' || unit.startsWith('hour') ? 3_600_000 : 86_400_000;
  const result = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`Invalid quota window: ${value}`);
  return result;
}
