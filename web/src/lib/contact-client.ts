import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export function contactClientHeaders(ip: string, secret: string): Record<string, string> {
  if (!isIP(ip)) return {};
  const value = `${Math.floor(Date.now() / 1000)}:${ip}`;
  return {
    'x-careersim-client': value,
    'x-careersim-client-signature': createHmac('sha256', secret).update(`contact-client:${value}`).digest('hex'),
  };
}

export function verifiedContactClientIp(headers: Headers, secret: string): string | null {
  const value = headers.get('x-careersim-client');
  const signature = headers.get('x-careersim-client-signature');
  if (!secret || !value || !signature || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const separator = value.indexOf(':');
  const timestamp = Number(value.slice(0, separator));
  const ip = value.slice(separator + 1);
  const now = Date.now() / 1000;
  if (!isIP(ip) || !Number.isFinite(timestamp) || timestamp < now - 60 || timestamp > now + 5) return null;
  const expected = createHmac('sha256', secret).update(`contact-client:${value}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? ip : null;
}
