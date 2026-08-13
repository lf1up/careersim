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
  it('moves the versioned surface — index, readiness, and pointers — to the new segment', async () => {
    const h = await buildTestApp({ versionPrefix: 'v2' });
    try {
      const missed = await h.app.inject({ method: 'GET', url: '/v1/health' });
      expect(missed.statusCode).toBe(404);

      const readiness = await h.app.inject({ method: 'GET', url: '/v2/health' });
      expect(readiness.statusCode).toBe(200);
      expect(readiness.json()).toEqual({
        status: 'ok',
        db: 'ok',
        agent: 'ok',
        cache: 'skipped',
        voice: 'skipped',
      });

      const liveness = await h.app.inject({ method: 'GET', url: '/health' });
      expect(liveness.statusCode).toBe(200);
      expect(liveness.json()).toEqual({ status: 'ok' });

      const index = await h.app.inject({ method: 'GET', url: '/v2' });
      expect(index.statusCode).toBe(200);
      expect(index.json()).toMatchObject({ health: '/v2/health' });
    } finally {
      await h.close();
    }
  });

  it('serves unprefixed versioned routes when the prefix is empty (bare-container / cloud default)', async () => {
    const h = await buildTestApp({ versionPrefix: '' });
    try {
      const missed = await h.app.inject({ method: 'GET', url: '/v1/health' });
      expect(missed.statusCode).toBe(404);

      // No version prefix → no versioned readiness route; `/health` is
      // the process liveness probe only (would otherwise collide).
      const health = await h.app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'ok' });

      const index = await h.app.inject({ method: 'GET', url: '/' });
      expect(index.statusCode).toBe(200);
      expect(index.json()).toMatchObject({ health: '/health' });
    } finally {
      await h.close();
    }
  });
});
