import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(8000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1),

    AGENT_API_URL: z.string().url(),

    // Shared secret sent as `X-Internal-Key` on every API ⇒ agent call.
    // Must match `AGENT_INTERNAL_KEY` on the agent side (see
    // agent/src/careersim_agent/config.py). When empty we still start —
    // the agent runs in "dev mode" and accepts unauthenticated calls —
    // but production deployments MUST set this to a long random string.
    AGENT_INTERNAL_KEY: z.string().default(''),

    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    JWT_EXPIRES_IN: z.string().default('7d'),

    // URL of the Next.js web app; embedded in magic-link and password-reset
    // emails so the links point at the correct origin per environment.
    WEB_APP_URL: z.string().url().default('http://localhost:3000'),

    // Outbound email. When SMTP_HOST is empty we log rendered emails to the
    // Fastify logger instead of sending (useful in dev / Vitest).
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    MAIL_FROM: z.string().default('careersim.local <no-reply@careersim.local>'),
    MAIL_PRODUCT_NAME: z.string().default('careersim.local'),

    // HMAC secret for ALTCHA proof-of-work challenges. Must be kept secret
    // server-side — the widget never sees it. Rotating invalidates any
    // in-flight challenges. 32+ chars recommended.
    ALTCHA_HMAC_KEY: z.string().min(16, 'ALTCHA_HMAC_KEY must be at least 16 characters'),
    // Upper bound for the random PoW target. Higher = slower solve. The default
    // (~50k) typically solves in well under a second on modern hardware.
    ALTCHA_MAX_NUMBER: z.coerce.number().int().positive().default(50_000),

    // ------------------------------------------------------------------
    // Rate limiting (@fastify/rate-limit)
    //
    // `RATE_LIMIT_ENABLED=false` disables the plugin entirely (useful in
    // integration tests, load tests, or during incidents where the limit
    // is itself an availability issue). When enabled and REDIS_URL is
    // set, buckets live in Redis so horizontally-scaled API instances
    // share state; otherwise they fall back to per-process LRU memory
    // (fine for a single-instance deploy).
    // ------------------------------------------------------------------
    RATE_LIMIT_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v !== 'false' && v !== '0'),
    REDIS_URL: z.string().default(''),

    // Per-user cap on creating new chat sessions. We keep this aggressive by
    // default (2 per 6 hours) because each session spins up an agent thread
    // and consumes LLM tokens; a sustained burst from one account is almost
    // always abuse or a runaway client, not legitimate use. Ops can loosen
    // these per environment without code changes.
    //
    // The window accepts anything `@fastify/rate-limit` understands: a
    // string like '1 hour' / '30 minutes' / '6 hours', or a number of ms.
    SESSIONS_CREATE_MAX: z.coerce.number().int().positive().default(2),
    SESSIONS_CREATE_WINDOW: z.string().default('6 hours'),
  })
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === 'production' &&
      env.SMTP_HOST &&
      /@[^>\s]*\.local(?:[>\s]|$)/i.test(env.MAIL_FROM)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_FROM'],
        message: 'MAIL_FROM must use a verified sender domain when SMTP is enabled in production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${errors}`);
  }
  return parsed.data;
}
