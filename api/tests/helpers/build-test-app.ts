import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';

import { createPgliteClient, type PgliteClientHandle } from '../../src/db/client.js';
import { buildApp } from '../../src/server.js';
import { FakeAgent } from './fake-agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '..', '..', 'src', 'db', 'migrations');

export interface TestHarness {
  app: FastifyInstance;
  agent: FakeAgent;
  db: PgliteClientHandle;
  close: () => Promise<void>;
}

export interface BuildTestAppOptions {
  agent?: FakeAgent;
}

export async function buildTestApp(options?: BuildTestAppOptions): Promise<TestHarness> {
  const pg = new PGlite();
  const handle = createPgliteClient(pg);
  await migrate(handle.db, { migrationsFolder });

  const agent = options?.agent ?? new FakeAgent();

  const app = await buildApp({
    db: handle.db,
    agent,
    jwtSecret: 'test-secret-test-secret-test-secret',
    jwtExpiresIn: '1h',
  });

  return {
    app,
    agent,
    db: handle,
    async close() {
      await app.close();
      await handle.close();
    },
  };
}

/** Register a user and return a ready-to-use Bearer header. */
export async function registerAndAuth(
  app: FastifyInstance,
  email = 'alice@example.com',
  password = 'super-secret-123',
): Promise<{ token: string; userId: string; authHeader: Record<string, string> }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password },
  });
  if (res.statusCode !== 201) {
    throw new Error(`registerAndAuth failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as { token: string; user: { id: string } };
  return {
    token: body.token,
    userId: body.user.id,
    authHeader: { authorization: `Bearer ${body.token}` },
  };
}
