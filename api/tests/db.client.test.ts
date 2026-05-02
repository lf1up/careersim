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
});
