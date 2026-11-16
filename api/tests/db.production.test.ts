import { spawnSync } from 'node:child_process';

import { expect, it } from 'vitest';

it('creates the PostgreSQL client without the development-only PGlite package', () => {
  const loader = `
    export function resolve(specifier, context, nextResolve) {
      if (specifier === '@electric-sql/pglite') {
        throw new Error('PGlite is not installed in production');
      }
      return nextResolve(specifier, context);
    }
  `;
  const clientUrl = new URL('../src/db/client.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { register } from 'node:module';
    register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loader)}`)});
    const { createPgClient } = await import(${JSON.stringify(clientUrl)});
    const handle = createPgClient('postgres://unused:unused@localhost:5432/unused');
    await handle.close();
  `], { encoding: 'utf8', timeout: 10_000 });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
