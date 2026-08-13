import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestHarness } from './helpers/build-test-app.js';

describe('CORS', () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('keeps CORS wide open for dev when the empty-allowlist override is on', async () => {
    harness = await buildTestApp({ corsAllowedOrigins: [], corsAllowAllWhenEmpty: true });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://preview.example.com' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('https://preview.example.com');
  });

  it('denies cross-origin requests when no allowlist is configured (production default)', async () => {
    harness = await buildTestApp({ corsAllowedOrigins: [] });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://preview.example.com' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('only echoes configured origins when an allowlist is configured', async () => {
    harness = await buildTestApp({ corsAllowedOrigins: ['https://app.example.com'] });

    const allowed = await harness.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://app.example.com' },
    });
    const blocked = await harness.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://preview.example.com' },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
