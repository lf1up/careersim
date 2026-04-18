import { HttpAgentClient } from './agent/client.js';
import { loadEnv } from './config/env.js';
import { createPgClient } from './db/client.js';
import { buildApp } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const dbHandle = createPgClient(env.DATABASE_URL);
  const agent = new HttpAgentClient(env.AGENT_API_URL);

  const app = await buildApp({
    db: dbHandle.db,
    agent,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
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
  app.log.info(`api listening on http://${env.HOST}:${env.PORT}`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
