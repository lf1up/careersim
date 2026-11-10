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

describe('personal contact', () => {
  let serial = 0;
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'test-only');
    vi.stubEnv('ALTCHA_HMAC_KEY', 'test-contact-hmac-key-at-least-32-characters');
    vi.stubEnv('API_INTERNAL_URL', 'http://api.internal/v1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
    send.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  function personal(overrides: Record<string, string> = {}, ip?: string) {
    serial += 1;
    const body = new FormData();
    for (const [key, value] of Object.entries({ audience: 'personal', reason: 'higher-limits', name: '<Practice>', email: `personal-${serial}@example.com`, message: 'I need more practice sessions for interviews.', altcha: 'test-intercepted-proof', ...overrides })) body.set(key, value);
    return new Request('https://careersim.ai/api/contact', { method: 'POST', body, headers: { 'x-forwarded-for': ip ?? `192.0.2.${serial}` } });
  }
  it('accepts a personal request without company and escapes mail HTML', async () => {
    expect((await POST(personal())).status).toBe(200);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('&lt;Practice&gt;'), text: expect.stringContaining('Higher limits') }));
    expect(send.mock.calls[0][0].html).not.toContain('<Practice>');
  });
  it('keeps company required for legacy business requests', async () => {
    expect((await POST(personal({ audience: '', useCase: 'training' }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ reason: 'invented' }, { audience: 'admin' }, { message: 'Short' }, { message: 'a'.repeat(4001) }, { name: 'a'.repeat(121) }, { email: 'invalid' }] as Array<Record<string, string>>)('rejects invalid labels and lengths: %j', async (overrides) => {
    expect((await POST(personal(overrides))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('requires CAPTCHA verification for personal requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    expect((await POST(personal())).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it('preserves honeypot and per-address limits', async () => {
    expect((await POST(personal({ website: 'spam' }))).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    for (let n = 0; n < 3; n++) expect((await POST(personal({}, '198.51.100.211'))).status).toBe(200);
    expect((await POST(personal({}, '198.51.100.211'))).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
