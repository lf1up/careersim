import { afterEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

import { buildTestApp, type TestHarness } from './helpers/build-test-app.js';

describe('client IP at the trusted ingress', () => {
  let h: TestHarness;
  afterEach(async () => { await h?.close(); });

  it('uses DigitalOcean client IPs for independent quotas without trusting ingress CIDRs', async () => {
    h = await buildTestApp({ clientIpSource: 'digitalocean', rateLimitEnabled: true });
    const remaining = [];
    for (const client of ['198.51.100.1', '2001:db8::1', '198.51.100.1']) {
      const response = await h.app.inject({ url: '/v1/auth/challenge', remoteAddress: '10.0.0.10', headers: { 'do-connecting-ip': client, 'x-forwarded-for': '172.66.0.96' } });
      remaining.push(response.headers['x-ratelimit-remaining']);
    }
    expect(remaining).toEqual(['59', '59', '58']);
  });

  it('ignores DigitalOcean headers unless that hosting provider is explicitly selected', async () => {
    h = await buildTestApp({ rateLimitEnabled: true });
    const remaining = [];
    for (const client of ['198.51.100.1', '198.51.100.2']) {
      const response = await h.app.inject({ url: '/v1/auth/challenge', remoteAddress: '203.0.113.10', headers: { 'do-connecting-ip': client } });
      remaining.push(response.headers['x-ratelimit-remaining']);
    }
    expect(remaining).toEqual(['59', '58']);
  });

  it('keeps malformed provider headers in the socket-peer bucket', async () => {
    h = await buildTestApp({ clientIpSource: 'digitalocean', rateLimitEnabled: true });
    const remaining = [];
    for (const client of ['198.51.100.1, 198.51.100.2', 'untrusted', '']) {
      const response = await h.app.inject({ url: '/v1/auth/challenge', remoteAddress: '10.0.0.10', headers: { 'do-connecting-ip': client } });
      remaining.push(response.headers['x-ratelimit-remaining']);
    }
    expect(remaining).toEqual(['59', '58', '57']);
  });

  it('gives separate clients behind a configured proxy independent rate limits', async () => {
    h = await buildTestApp({ trustedProxies: ['10.0.0.10'], rateLimitEnabled: true });
    const remaining = [];
    for (const client of ['198.51.100.1', '198.51.100.2', '198.51.100.1']) {
      const response = await h.app.inject({ method: 'GET', url: '/v1/auth/challenge', remoteAddress: '10.0.0.10', headers: { 'x-forwarded-for': client } });
      remaining.push(response.headers['x-ratelimit-remaining']);
    }
    expect(remaining).toEqual(['59', '59', '58']);
  });

  it('ignores spoofed forwarded headers from an untrusted socket peer', async () => {
    h = await buildTestApp({ trustedProxies: ['10.0.0.10'], rateLimitEnabled: true });
    const remaining = [];
    for (const client of ['198.51.100.1', '198.51.100.2']) {
      const response = await h.app.inject({ method: 'GET', url: '/v1/auth/challenge', remoteAddress: '203.0.113.10', headers: { 'x-forwarded-for': client } });
      remaining.push(response.headers['x-ratelimit-remaining']);
    }
    expect(remaining).toEqual(['59', '58']);
  });

  it.each(['socket', 'digitalocean'] as const)('separates authenticated contact visitors sharing the web server egress (%s)', async (clientIpSource) => {
    h = await buildTestApp({ clientIpSource, rateLimitEnabled: true });
    const remaining = [];
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.1']) {
      const client = `${Math.floor(Date.now() / 1000)}:${ip}`;
      const signature = createHmac('sha256', 'test-altcha-hmac-key-test-altcha-hmac-key').update(`contact-client:${client}`).digest('hex');
      const response = await h.app.inject({ url: '/v1/auth/challenge', remoteAddress: '203.0.113.10', headers: { 'do-connecting-ip': '203.0.113.10', 'x-careersim-client': client, 'x-careersim-client-signature': signature } });
      remaining.push(response.headers['x-ratelimit-remaining']);
    }
    expect(remaining).toEqual(['59', '59', '58']);
  });

  it('rejects forged or expired contact identity metadata', async () => {
    h = await buildTestApp({ rateLimitEnabled: true });
    for (const forged of [true, false]) {
      const client = `${Math.floor(Date.now() / 1000) - (forged ? 0 : 120)}:198.51.100.1`;
      const signature = forged ? '0'.repeat(64) : createHmac('sha256', 'test-altcha-hmac-key-test-altcha-hmac-key').update(`contact-client:${client}`).digest('hex');
      const response = await h.app.inject({ url: '/v1/auth/challenge', remoteAddress: '203.0.113.10', headers: { 'x-careersim-client': client, 'x-careersim-client-signature': signature } });
      expect(response.statusCode).toBe(400);
    }
  });
});
