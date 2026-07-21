import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestHarness } from './helpers/build-test-app.js';

describe('GET /v1', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await buildTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  it('includes agent status in the service index', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'careersim-api',
      version: '1.0.0',
      status: 'ok',
      agent: 'ok',
      health: '/v1/health',
    });
  });

  it('reports agent errors without failing the service index', async () => {
    h.agent.health = async () => {
      throw new Error('down');
    };

    const res = await h.app.inject({ method: 'GET', url: '/v1' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      agent: 'error',
    });
  });
});

describe('custom version prefix (API_VERSION_PREFIX)', () => {
  it('moves the whole surface — index, health, and pointers — to the new segment', async () => {
    const h = await buildTestApp({ versionPrefix: 'v2' });
    try {
      const missed = await h.app.inject({ method: 'GET', url: '/v1/health' });
      expect(missed.statusCode).toBe(404);

      const health = await h.app.inject({ method: 'GET', url: '/v2/health' });
      expect(health.statusCode).toBe(200);

      const index = await h.app.inject({ method: 'GET', url: '/v2' });
      expect(index.statusCode).toBe(200);
      expect(index.json()).toMatchObject({ health: '/v2/health' });
    } finally {
      await h.close();
    }
  });

  it('serves unprefixed routes when the prefix is empty (bare-container / cloud default)', async () => {
    const h = await buildTestApp({ versionPrefix: '' });
    try {
      const missed = await h.app.inject({ method: 'GET', url: '/v1/health' });
      expect(missed.statusCode).toBe(404);

      const health = await h.app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);

      const index = await h.app.inject({ method: 'GET', url: '/' });
      expect(index.statusCode).toBe(200);
      expect(index.json()).toMatchObject({ health: '/health' });
    } finally {
      await h.close();
    }
  });
});
