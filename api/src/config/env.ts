import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1),

  AGENT_API_URL: z.string().url(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  /**
   * Minimum seconds of silence (since the last human message) before an
   * inactivity nudge is allowed to fire. Guardrail on the /nudge endpoint.
   */
  NUDGE_MIN_IDLE_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /**
   * Maximum inactivity nudges the API will dispatch between two human
   * messages. Prevents the AI from nudging into the void.
   */
  NUDGE_MAX_PER_SILENCE: z.coerce.number().int().nonnegative().default(2),
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
