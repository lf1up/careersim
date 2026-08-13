import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPgPoolConfig } from '../src/db/client.js';

describe('buildPgPoolConfig', () => {
  it('uses the connection string without SSL by default', () => {
    const config = buildPgPoolConfig('postgres://user:pass@localhost:5432/careersim');

    expect(config).toEqual({
      connectionString: 'postgres://user:pass@localhost:5432/careersim',
    });
  });

  it('enables SSL when the connection string requires it', () => {
    const config = buildPgPoolConfig('postgres://user:pass@db.example.com:5432/careersim?sslmode=require');

    expect(config).toEqual({
      connectionString: 'postgres://user:pass@db.example.com:5432/careersim',
      ssl: { rejectUnauthorized: false },
    });
  });

  it('removes only sslmode from SSL connection strings', () => {
    const config = buildPgPoolConfig(
      'postgres://user:pass@db.example.com:5432/careersim?connect_timeout=10&sslmode=require',
    );

    expect(config).toEqual({
      connectionString: 'postgres://user:pass@db.example.com:5432/careersim?connect_timeout=10',
      ssl: { rejectUnauthorized: false },
    });
  });

  it('verifies the server certificate when sslmode is verify-full', () => {
    const config = buildPgPoolConfig('postgres://user:pass@db.example.com:5432/careersim?sslmode=verify-full');

    expect(config).toEqual({
      connectionString: 'postgres://user:pass@db.example.com:5432/careersim',
      ssl: { rejectUnauthorized: true },
    });
  });

  it('loads a pinned CA when verify-full provides sslrootcert', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-ca-'));
    const caPath = join(dir, 'ca.pem');
    writeFileSync(caPath, 'TEST-CA');
    try {
      const config = buildPgPoolConfig(
        `postgres://user:pass@db.example.com:5432/careersim?sslmode=verify-full&sslrootcert=${caPath}`,
      );

      expect(config).toEqual({
        connectionString: 'postgres://user:pass@db.example.com:5432/careersim',
        ssl: { rejectUnauthorized: true, ca: 'TEST-CA' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
