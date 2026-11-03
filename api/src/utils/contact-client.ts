import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/** Only our contact proxies may attest to a visitor behind their shared egress. */
export function contactClientIp(value: unknown, signature: unknown, secret: string): string | null {
  if (typeof value !== 'string' || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const separator = value.indexOf(':');
  const timestamp = Number(value.slice(0, separator));
  const ip = value.slice(separator + 1);
  const now = Date.now() / 1000;
  if (!isIP(ip) || !Number.isFinite(timestamp) || timestamp < now - 60 || timestamp > now + 5) return null;
  const expected = createHmac('sha256', secret).update(`contact-client:${value}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? ip : null;
}

declare module 'fastify' {
  interface FastifyRequest { rateLimitClientIp: string | null; }
}
