import type { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import { schema, type Schema } from '../../src/db/client.js';

export interface PgliteClientHandle {
  db: PgliteDatabase<Schema>;
  client: PGlite;
  close(): Promise<void>;
}

export function createPgliteClient(client: PGlite): PgliteClientHandle {
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    async close() {
      await client.close();
    },
  };
}
