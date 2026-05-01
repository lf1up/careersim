import { HttpAgentClient } from './agent/client.js';
import { loadEnv } from './config/env.js';
import { createPgClient } from './db/client.js';
import { buildApp } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const dbHandle = createPgClient(env.DATABASE_URL);
  const agent = new HttpAgentClient(env.AGENT_API_URL, {
    internalKey: env.AGENT_INTERNAL_KEY || undefined,
  });

  const app = await buildApp({
    db: dbHandle.db,
    agent,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    webAppUrl: env.WEB_APP_URL,
    mail: {
      from: env.MAIL_FROM,
      productName: env.MAIL_PRODUCT_NAME,
      smtp: env.SMTP_HOST
        ? {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          }
        : undefined,
    },
    altcha: {
      hmacKey: env.ALTCHA_HMAC_KEY,
      maxNumber: env.ALTCHA_MAX_NUMBER,
    },
    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED,
      redisUrl: env.REDIS_URL || undefined,
      createSessionMax: env.SESSIONS_CREATE_MAX,
      createSessionTimeWindow: env.SESSIONS_CREATE_WINDOW,
    },
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
  });

  const close = async () => {
    try {
      await app.close();
    } finally {
      await dbHandle.close();
    }
  };

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      app.log.info({ sig }, 'shutting down');
      close().then(() => process.exit(0), () => process.exit(1));
    });
  }

  await app.listen({ host: env.HOST, port: env.PORT });

  // `HOST=0.0.0.0` (or `::`) is how we bind inside containers so Docker's
  // port mapping to the host works, but it's not a useful *clickable* URL
  // for humans. Display `localhost` in the splash while keeping the bind
  // address in the structured log for ops.
  const displayHost =
    env.HOST === '0.0.0.0' || env.HOST === '::' || env.HOST === '0' ? 'localhost' : env.HOST;
  const baseUrl = `http://${displayHost}:${env.PORT}`;
  const rateLimitState = env.RATE_LIMIT_ENABLED
    ? env.REDIS_URL
      ? 'enabled (Redis store)'
      : 'enabled (in-memory store)'
    : 'disabled';
  // The agent defaults to dev-mode (unauthenticated) when its
  // AGENT_INTERNAL_KEY is empty; surface the matching API-side state
  // here so ops notice a missing key at startup rather than when a
  // wrong-header 401 hits production traffic.
  const agentAuthState = env.AGENT_INTERNAL_KEY
    ? 'shared secret configured'
    : 'unauthenticated (AGENT_INTERNAL_KEY unset)';

  app.log.info(`api listening on http://${env.HOST}:${env.PORT}`);
  if (!env.AGENT_INTERNAL_KEY && env.NODE_ENV === 'production') {
    app.log.warn(
      'AGENT_INTERNAL_KEY is unset in production — agent calls are unauthenticated. ' +
        'Set it on both the API and the agent to match.',
    );
  }

  const line = '='.repeat(60);
  process.stdout.write(
    [
      '',
      line,
      `CareerSIM API — ${env.NODE_ENV === 'production' ? 'Production' : 'Developer'} Console`,
      line,
      '',
      `  URL:   ${baseUrl}`,
      `  Docs:  ${baseUrl}/docs`,
      `  Spec:  ${baseUrl}/docs/openapi.json`,
      '',
      `  Rate:  ${rateLimitState}`,
      `  Agent: ${env.AGENT_API_URL}`,
      `  Auth:  ${agentAuthState}`,
      '',
      '  Press Ctrl+C to stop',
      line,
      '',
      '',
    ].join('\n'),
  );
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
