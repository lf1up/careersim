// @vitest-environment node
import { createChallenge, solveChallenge } from 'altcha-lib/v1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

import { POST } from './route';
import { GET } from '../altcha-challenge/route';
import { proxyContactRequest } from '../../../../../landing/src/lib/contact-proxy';

describe('contact CAPTCHA boundary', () => {
  beforeEach(() => {
    vi.stubEnv('ALTCHA_HMAC_KEY', 'test-contact-hmac-key-at-least-32-characters');
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key');
    vi.stubEnv('API_INTERNAL_URL', 'http://api.internal/v1');
    vi.stubEnv('LANDING_SITE_URL', 'https://careersim.ai');
    send.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function payload() {
    const challenge = await createChallenge({ hmacKey: process.env.ALTCHA_HMAC_KEY!, maxNumber: 100, expires: new Date(Date.now() + 60000) });
    const solved = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
    return Buffer.from(JSON.stringify({ ...challenge, number: solved!.number })).toString('base64');
  }

  function request(altcha: string, url = 'https://careersim.ai/api/contact') {
    const body = new FormData();
    for (const [name, value] of Object.entries({ name: 'Test', email: 'contact-security@example.com', company: 'Example', useCase: 'training', message: 'A sufficiently detailed test inquiry.', altcha })) body.set(name, value);
    return new Request(url, { method: 'POST', body });
  }

  it('does not deliver email when the shared verifier rejects a replay', async () => {
    let consumed = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url !== 'http://api.internal/v1/auth/challenge/verify' || init.method !== 'POST') throw new Error('Unexpected verification destination');
      const status = consumed ? 400 : 200;
      consumed = true;
      return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: 'CAPTCHA_INVALID' }), { status });
    });
    const altcha = await payload();
    expect((await POST(request(altcha))).status).toBe(200);
    expect((await POST(request(altcha))).status).toBe(400);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the shared verifier is unavailable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('upstream unavailable'); });
    expect((await POST(request(await payload()))).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it('issues challenges through the API and prevents caching', async () => {
    const challenge = { algorithm: 'SHA-256', challenge: 'api-challenge', salt: 'api-salt', signature: 'api-signature', maxnumber: 100 };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url !== 'http://api.internal/v1/auth/challenge') throw new Error('Unexpected challenge destination');
      return Response.json(challenge);
    });
    const response = await GET(new Request('https://careersim.ai/api/altcha-challenge'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(challenge);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('passes upstream verification failures through the standalone landing proxy', async () => {
    vi.stubGlobal('fetch', async () => new Response('Unavailable', { status: 503 }));
    const response = await proxyContactRequest(request(await payload(), 'https://landing.example/api/contact'), '/api/contact');
    expect(response.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it('forwards standalone landing challenges to the canonical web handler', async () => {
    vi.stubGlobal('fetch', async (url: URL | string) => {
      if (String(url) !== 'https://careersim.ai/api/altcha-challenge') throw new Error('Unexpected challenge destination');
      return Response.json({ challenge: 'canonical-challenge' });
    });
    const response = await proxyContactRequest(new Request('https://landing.example/api/altcha-challenge'), '/api/altcha-challenge');
    expect(await response.json()).toEqual({ challenge: 'canonical-challenge' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
