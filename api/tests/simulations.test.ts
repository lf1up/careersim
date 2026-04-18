import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

describe('GET /simulations', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('requires auth', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/simulations' });
    expect(res.statusCode).toBe(401);
  });

  it('proxies the agent response', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const res = await h.app.inject({
      method: 'GET',
      url: '/simulations',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.simulations)).toBe(true);
    expect(body.simulations[0]).toMatchObject({
      slug: expect.any(String),
      title: expect.any(String),
      persona_name: expect.any(String),
    });
    expect(h.agent.callLog).toContain('listSimulations');
  });
});
