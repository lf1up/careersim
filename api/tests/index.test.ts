import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestHarness } from './helpers/build-test-app.js';

describe('GET /', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await buildTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  it('includes agent status in the service index', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'careersim-api',
      version: '0.1.0',
      status: 'ok',
      agent: 'ok',
      health: '/health',
    });
  });

  it('reports agent errors without failing the service index', async () => {
    h.agent.health = async () => {
      throw new Error('down');
    };

    const res = await h.app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      agent: 'error',
    });
  });
});
