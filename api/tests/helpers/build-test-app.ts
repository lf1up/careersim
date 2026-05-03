import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';

import { createPgliteClient, type PgliteClientHandle } from '../../src/db/client.js';
import { buildApp } from '../../src/server.js';
import { ALTCHA_TEST_BYPASS_TOKEN } from '../../src/plugins/altcha.js';
import type { MailMessage } from '../../src/plugins/mailer.js';
import { FakeAgent } from './fake-agent.js';

/**
 * Fixed CAPTCHA payload that the test harness uses in place of a real
 * PoW solution. Re-exported so individual tests can include it in
 * request payloads.
 */
export const TEST_ALTCHA = ALTCHA_TEST_BYPASS_TOKEN;

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '..', '..', 'src', 'db', 'migrations');
const TEST_SITE_NAME = process.env.MAIL_PRODUCT_NAME ?? 'careersim.local';

export interface TestHarness {
  app: FastifyInstance;
  agent: FakeAgent;
  db: PgliteClientHandle;
  outbox: MailMessage[];
  close: () => Promise<void>;
}

export interface BuildTestAppOptions {
  agent?: FakeAgent;
  nodeEnv?: 'development' | 'test' | 'production';
  /**
   * When true (default), the app accepts {@link ALTCHA_TEST_BYPASS_TOKEN}
   * in place of a real PoW payload. Set to false in a dedicated test
   * that exercises real CAPTCHA verification against the widget lib.
   */
  altchaBypass?: boolean;
  /**
   * When true (default: false), `@fastify/rate-limit` is registered
   * with its normal global + per-route limits. The general suite
   * leaves it off so tests don't collide with buckets; the dedicated
   * `rate-limit.test.ts` flips it on and asserts the policy.
   */
  rateLimitEnabled?: boolean;
  /** Optional override for the global ceiling used by rate-limit tests. */
  rateLimitGlobalMax?: number;
  rateLimitGlobalTimeWindow?: string;
}

export async function buildTestApp(options?: BuildTestAppOptions): Promise<TestHarness> {
  const pg = new PGlite();
  const handle = createPgliteClient(pg);
  await migrate(handle.db, { migrationsFolder });

  const agent = options?.agent ?? new FakeAgent();
  const outbox: MailMessage[] = [];

  const app = await buildApp({
    db: handle.db,
    agent,
    jwtSecret: 'test-secret-test-secret-test-secret',
    jwtExpiresIn: '1h',
    nodeEnv: options?.nodeEnv ?? 'test',
    webAppUrl: 'http://localhost:3000',
    logger: process.env.VITEST_DEBUG === '1' ? { level: 'debug' } : false,
    mail: {
      from: `${TEST_SITE_NAME} Test <no-reply@test.careersim.local>`,
      productName: TEST_SITE_NAME,
      devFallback: true,
      outbox,
    },
    altcha: {
      hmacKey: 'test-altcha-hmac-key-test-altcha-hmac-key',
      maxNumber: 1_000,
      bypass: options?.altchaBypass ?? true,
    },
    rateLimit: {
      enabled: options?.rateLimitEnabled ?? false,
      globalMax: options?.rateLimitGlobalMax,
      globalTimeWindow: options?.rateLimitGlobalTimeWindow,
    },
  });

  return {
    app,
    agent,
    db: handle,
    outbox,
    async close() {
      await app.close();
      await handle.close();
    },
  };
}

/**
 * Register a verified user (skipping the email code loop) and return a
 * ready-to-use Bearer header. Uses the test helper on auth.service via
 * a direct DB update, and then logs in normally.
 */
export async function registerAndAuth(
  app: FastifyInstance,
  email = 'alice@example.com',
  password = 'super-secret-123',
): Promise<{ token: string; userId: string; authHeader: Record<string, string> }> {
  // Step 1: request registration (creates user, emits a verification code).
  const register = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, altcha: TEST_ALTCHA },
  });
  if (register.statusCode !== 202) {
    throw new Error(`registerAndAuth register failed: ${register.statusCode} ${register.body}`);
  }

  // Step 2: pull the code out of the mail outbox and submit it.
  // The mail body contains the 6-digit code; extract it.
  type FastifyWithOutbox = FastifyInstance & { mailOutbox?: MailMessage[] };
  const outbox = (app as FastifyWithOutbox).mailOutbox;
  const match = outbox?.slice().reverse().find((m) => m.to === email.toLowerCase());
  if (!match) throw new Error('registerAndAuth: no verification email in outbox');
  const codeMatch = match.text.match(/\b(\d{6})\b/);
  if (!codeMatch) throw new Error(`registerAndAuth: no 6-digit code in email: ${match.text}`);
  const code = codeMatch[1];

  const verify = await app.inject({
    method: 'POST',
    url: '/auth/verify-email',
    payload: { email, code },
  });
  if (verify.statusCode !== 200) {
    throw new Error(`registerAndAuth verify failed: ${verify.statusCode} ${verify.body}`);
  }
  const body = verify.json() as { token: string; user: { id: string } };
  return {
    token: body.token,
    userId: body.user.id,
    authHeader: { authorization: `Bearer ${body.token}` },
  };
}
