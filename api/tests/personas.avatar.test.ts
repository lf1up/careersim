import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestHarness } from './helpers/build-test-app.js';

describe('GET /personas/:slug/avatar', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('is publicly accessible and proxies avatar bytes', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/personas/alex/avatar',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBeTruthy();
    expect(res.body.length).toBeGreaterThan(0);
    expect(h.agent.callLog).toContain('getPersonaAvatar:alex');
  });

  it('returns 404 when avatar is missing', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/personas/does-not-exist/avatar',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: 'avatar_not_found',
      message: expect.stringContaining('does-not-exist'),
    });
    expect(h.agent.callLog).toContain('getPersonaAvatar:does-not-exist');
  });
});
