import Fastify from 'fastify';
import { solveChallenge } from 'altcha-lib/v1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import altchaPlugin from '../src/plugins/altcha.js';
import { buildTestApp, type TestHarness } from './helpers/build-test-app.js';

describe('CAPTCHA replay protection', () => {
  let h: TestHarness;
  beforeEach(async () => { h = await buildTestApp({ altchaBypass: false }); });
  afterEach(async () => { await h.close(); });

  async function solution(): Promise<string> {
    const challenge = (await h.app.inject({ method: 'GET', url: '/v1/auth/challenge' })).json();
    const solved = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
    if (!solved) throw new Error('Could not solve test challenge');
    return Buffer.from(JSON.stringify({ ...challenge, number: solved.number })).toString('base64');
  }

  it('accepts a challenge only once even across concurrent API instances', async () => {
    const other = Fastify();
    await other.register(altchaPlugin, { db: h.db.db, hmacKey: 'test-altcha-hmac-key-test-altcha-hmac-key' });
    try {
      const payload = await solution();
      const results = await Promise.allSettled([h.app.altcha.verify(payload), other.altcha.verify(payload)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await expect(h.app.altcha.verify(payload)).rejects.toMatchObject({ code: 'CAPTCHA_INVALID' });
    } finally { await other.close(); }
  });

  it('does not let contact verification consume the same challenge twice or reuse it for signup', async () => {
    const altcha = await solution();
    const first = await h.app.inject({ method: 'POST', url: '/v1/auth/challenge/verify', payload: { altcha } });
    expect(first.statusCode).toBe(200);
    const second = await h.app.inject({ method: 'POST', url: '/v1/auth/challenge/verify', payload: { altcha } });
    expect(second.statusCode).toBe(400);
    const registration = await h.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'replay@example.com', altcha } });
    expect(registration.statusCode).toBe(400);
    expect(h.outbox).toHaveLength(0);
  });

  it('does not cache challenges', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/v1/auth/challenge' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
