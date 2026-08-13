import { readFileSync } from 'node:fs';

import { Pool, type PoolConfig } from 'pg';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import type { PGlite } from '@electric-sql/pglite';

import * as schema from './schema.js';

export type Schema = typeof schema;

/**
 * Common drizzle interface shared by production (node-postgres) and tests
 * (pglite). Both implementations expose the same query builder surface via
 * `PgDatabase`.
 */
export type AppDatabase = NodePgDatabase<Schema> | PgliteDatabase<Schema>;

export interface PgClientHandle {
  db: NodePgDatabase<Schema>;
  pool: Pool;
  close(): Promise<void>;
}

export function buildPgPoolConfig(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get('sslmode')?.toLowerCase();

  if (sslMode === 'require') {
    // Postgres semantics: encrypt, but don't verify the server identity —
    // encrypted yet MITM-able. Kept for compatibility; use `verify-full`
    // with `sslrootcert` in production so the server certificate is checked.
    url.searchParams.delete('sslmode');
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
    };
  }

  if (sslMode === 'verify-ca' || sslMode === 'verify-full') {
    url.searchParams.delete('sslmode');
    // node-postgres doesn't understand the libpq `sslrootcert` param, so
    // resolve it ourselves; without it, the system CA store is used.
    const sslRootCert = url.searchParams.get('sslrootcert');
    url.searchParams.delete('sslrootcert');
    return {
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: true,
        ...(sslRootCert ? { ca: readFileSync(sslRootCert, 'utf8') } : {}),
      },
    };
  }

  return { connectionString: databaseUrl };
}

export function createPgClient(databaseUrl: string): PgClientHandle {
  const pool = new Pool(buildPgPoolConfig(databaseUrl));
  const db = drizzlePg(pool, { schema });
  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}

export interface PgliteClientHandle {
  db: PgliteDatabase<Schema>;
  client: PGlite;
  close(): Promise<void>;
}

export function createPgliteClient(client: PGlite): PgliteClientHandle {
  const db = drizzlePglite(client, { schema });
  return {
    db,
    client,
    async close() {
      await client.close();
    },
  };
}

export { schema };
