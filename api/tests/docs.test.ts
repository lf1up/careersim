import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestHarness } from './helpers/build-test-app.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

describe('API docs', () => {
  let h: TestHarness | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it('serves Swagger UI and OpenAPI JSON in development', async () => {
    h = await buildTestApp({ nodeEnv: 'development' });

    const docs = await h.app.inject({ method: 'GET', url: '/v1/docs' });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toContain('text/html');

    const spec = await h.app.inject({ method: 'GET', url: '/v1/docs/openapi.json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json()).toMatchObject({
      info: { title: 'CareerSIM API', version: pkg.version },
    });
  });

  it('does not register docs routes outside development', async () => {
    h = await buildTestApp({ nodeEnv: 'production' });

    const docs = await h.app.inject({ method: 'GET', url: '/v1/docs' });
    expect(docs.statusCode).toBe(404);

    const spec = await h.app.inject({ method: 'GET', url: '/v1/docs/openapi.json' });
    expect(spec.statusCode).toBe(404);
  });
});
