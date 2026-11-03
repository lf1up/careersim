import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { loadEnv } from '../config/env.js';
import { loadInstalledPlugins } from '../extensions/loader.js';
import { applyPluginMigrations } from '../extensions/migrate.js';
import { createPgClient } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, 'migrations');

async function main(): Promise<void> {
  const env = loadEnv();
  const handle = createPgClient(env.DATABASE_URL);
  try {
    await migrate(handle.db, { migrationsFolder });
    console.log(`Migrations applied from ${migrationsFolder}`);
    const plugins = await loadInstalledPlugins();
    await applyPluginMigrations(handle.db, plugins, migrate);
    for (const plugin of plugins) {
      if (plugin.migrations) {
        console.log(`Plugin ${plugin.id} migrations applied from ${plugin.migrations.folder}`);
      }
    }
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
