// @vitest-environment node
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientIp } from './contact-rate-limit';
import { GET } from '../app/api/altcha-challenge/route';
import { proxyContactRequest } from '../../../landing/src/lib/contact-proxy';

const secret = 'test-contact-proxy-key-with-enough-entropy';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('authenticated contact visitor forwarding', () => {
  it('uses signed landing visitor identity while ignoring forged identity', () => {
    vi.stubEnv('ALTCHA_HMAC_KEY', secret);
    const value = `${Math.floor(Date.now() / 1000)}:198.51.100.20`;
    const signature = createHmac('sha256', secret).update(`contact-client:${value}`).digest('hex');
    const request = (sig: string) => new Request('https://careersim.ai/api/contact', { headers: { 'x-careersim-client': value, 'x-careersim-client-signature': sig, 'x-forwarded-for': '203.0.113.1' } });
    expect(clientIp(request(signature))).toBe('198.51.100.20');
    expect(clientIp(request('0'.repeat(64)))).toBe('203.0.113.1');
  });

  it('authenticates distinct visitors when proxying challenges to the API', async () => {
    vi.stubEnv('ALTCHA_HMAC_KEY', secret);
    vi.stubEnv('API_INTERNAL_URL', 'https://api.internal/v1');
    const clients: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
      const headers = new Headers(options.headers);
      const value = headers.get('x-careersim-client')!;
      const signature = headers.get('x-careersim-client-signature');
      expect(signature).toBe(createHmac('sha256', secret).update(`contact-client:${value}`).digest('hex'));
      clients.push(value.slice(value.indexOf(':') + 1));
      return Response.json({ challenge: 'test' });
    });
    for (const ip of ['198.51.100.1', '198.51.100.2']) {
      expect((await GET(new Request('https://careersim.ai/api/altcha-challenge', { headers: { 'x-forwarded-for': ip } }))).status).toBe(200);
    }
    expect(clients).toEqual(['198.51.100.1', '198.51.100.2']);
  });

  it('authenticates standalone landing visitor identity without accepting caller signatures', async () => {
    vi.stubEnv('ALTCHA_HMAC_KEY', secret);
    vi.stubEnv('LANDING_SITE_URL', 'https://careersim.ai');
    vi.stubGlobal('fetch', async (_url: URL, options: RequestInit) => {
      const headers = new Headers(options.headers);
      const value = headers.get('x-careersim-client')!;
      expect(value.slice(value.indexOf(':') + 1)).toBe('198.51.100.30');
      expect(headers.get('x-careersim-client-signature')).toBe(createHmac('sha256', secret).update(`contact-client:${value}`).digest('hex'));
      return Response.json({ challenge: 'test' });
    });
    const request = new Request('https://landing.example/api/altcha-challenge', { headers: { 'x-forwarded-for': '198.51.100.30', 'x-careersim-client': 'forged', 'x-careersim-client-signature': 'forged' } });
    expect((await proxyContactRequest(request, '/api/altcha-challenge')).status).toBe(200);
  });
});
