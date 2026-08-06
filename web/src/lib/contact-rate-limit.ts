/**
 * Best-effort sliding-window limiter for the /business contact form.
 *
 * In-memory only — on Vercel each warm isolate keeps its own map, so this
 * caps bursts within an instance rather than globally. Paired with ALTCHA
 * + honeypot that's enough for low-volume inquiry spam. For a hard
 * cross-instance cap, swap this for Redis/Upstash later.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_HITS = 3;

type Bucket = number[];

const buckets = new Map<string, Bucket>();

function prune(hits: Bucket, now: number): Bucket {
  return hits.filter((ts) => now - ts < WINDOW_MS);
}

function remaining(key: string, now: number): number {
  const next = prune(buckets.get(key) ?? [], now);
  buckets.set(key, next);
  return MAX_HITS - next.length;
}

function hit(key: string, now: number): void {
  const next = prune(buckets.get(key) ?? [], now);
  next.push(now);
  buckets.set(key, next);
}

/**
 * Allow the request only if every key still has quota, then record a hit
 * on each. Fails closed without consuming when any key is exhausted.
 */
export function consumeContactQuotas(keys: string[]): boolean {
  const now = Date.now();
  if (keys.some((key) => remaining(key, now) <= 0)) return false;
  for (const key of keys) hit(key, now);
  return true;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  );
}

export const CONTACT_RATE_LIMIT_MESSAGE =
  'Too many inquiries from this address — please try again in about an hour, or email us directly.';
