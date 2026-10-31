import type { ApiPlugin } from './sdk.js';

/**
 * The node-postgres and pglite migrators share this call shape. `never` keeps
 * both drivers assignable: each migrator only accepts its own database type,
 * and the caller passes the matching one.
 */
export interface MigrateFn {
  (
    db: never,
    config: { migrationsFolder: string; migrationsSchema?: string; migrationsTable?: string },
  ): Promise<void>;
}

/**
 * Apply each plugin's SQL after the core migrations. The migrations table
 * lives in the plugin schema (`migrationsSchema`), so it never shares the
 * core `drizzle.__drizzle_migrations` table.
 */
export async function applyPluginMigrations(
  db: unknown,
  plugins: readonly ApiPlugin[],
  migrateFn: MigrateFn,
): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin.migrations) continue;
    await migrateFn(db as never, {
      migrationsFolder: plugin.migrations.folder,
      migrationsSchema: plugin.migrations.schema,
    });
  }
}
