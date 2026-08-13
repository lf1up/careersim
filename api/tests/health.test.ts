import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestHarness } from './helpers/build-test-app.js';

describe('GET /health (process liveness)', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('reports ok without probing db or agent', async () => {
    h.agent.health = async () => {
      throw new Error('down');
    };
    const res = await h.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('stays at the app root when the version prefix changes', async () => {
    await h.close();
    h = await buildTestApp({ versionPrefix: 'v2' });
    const res = await h.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /v1/health (version readiness)', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('reports ok when db + agent are reachable', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      db: 'ok',
      agent: 'ok',
      cache: 'skipped',
      voice: 'skipped',
    });
  });

  it('reports degraded when the agent is down', async () => {
    h.agent.health = async () => {
      throw new Error('down');
    };
    const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.agent).toBe('error');
    expect(body.db).toBe('ok');
    expect(body.cache).toBe('skipped');
    expect(body.voice).toBe('skipped');
  });

  it('reports ok when the cache ping succeeds', async () => {
    await h.close();
    h = await buildTestApp({ cache: { ping: async () => undefined } });
    const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      db: 'ok',
      agent: 'ok',
      cache: 'ok',
      voice: 'skipped',
    });
  });

  it('reports degraded when the cache ping fails', async () => {
    await h.close();
    h = await buildTestApp({
      cache: {
        ping: async () => {
          throw new Error('down');
        },
      },
    });
    const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'degraded',
      db: 'ok',
      agent: 'ok',
      cache: 'error',
      voice: 'skipped',
    });
  });

  it('reports ok when the voice worker ping succeeds', async () => {
    await h.close();
    h = await buildTestApp({ voiceHealth: { ping: async () => undefined } });
    const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      db: 'ok',
      agent: 'ok',
      cache: 'skipped',
      voice: 'ok',
    });
  });

  it('reports degraded when the voice worker ping fails', async () => {
    await h.close();
    h = await buildTestApp({
      voiceHealth: {
        ping: async () => {
          throw new Error('down');
        },
      },
    });
    const res = await h.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'degraded',
      db: 'ok',
      agent: 'ok',
      cache: 'skipped',
      voice: 'error',
    });
  });
});
