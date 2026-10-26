import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let apiRoot = '';
let webRoot = '';
let testRoot = '';
const fixtureDir = join(repoRoot, 'api/tests/fixtures/plugin-src');

const overlays = () => [
  join(apiRoot, 'src/extensions/installed'),
  join(apiRoot, 'dist/extensions/installed'),
  join(webRoot, 'src/extensions/installed'),
  join(webRoot, 'src/app/(app)/(plugins)'),
  join(webRoot, 'src/app/(public)/(plugins)'),
];

async function run(
  script: string,
  env: Record<string, string | undefined>,
  command = 'fetch',
) {
  const childEnv = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
  }
  try {
    await execFileAsync('node', [script, command], { env: childEnv, cwd: dirname(script) });
  } catch (err) {
    const error = err as { stderr?: string; message?: string };
    throw new Error(`${error.stderr ?? ''}\n${error.message ?? ''}`);
  }
}

describe('plugins.mjs', () => {
  beforeEach(async () => {
    testRoot = await realpath(await mkdtemp(join(tmpdir(), 'careersim-plugin-host-')));
    apiRoot = join(testRoot, 'api');
    webRoot = join(testRoot, 'web');
    for (const name of ['api', 'web']) {
      await mkdir(join(testRoot, name, 'scripts'), { recursive: true });
      await cp(join(repoRoot, name, 'scripts/plugins.mjs'), join(testRoot, name, 'scripts/plugins.mjs'));
    }
    await writeFile(join(webRoot, 'next.config.mjs'), 'export default {};');
  });
  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('keeps the api and web copies of plugins.mjs identical', async () => {
    const api = await readFile(join(apiRoot, 'scripts/plugins.mjs'), 'utf8');
    const web = await readFile(join(webRoot, 'scripts/plugins.mjs'), 'utf8');
    expect(api).toBe(web);
  });

  it('does nothing when CAREERSIM_PLUGINS is unset', async () => {
    await run(join(apiRoot, 'scripts/plugins.mjs'), { CAREERSIM_PLUGINS: undefined });
    await run(join(webRoot, 'scripts/plugins.mjs'), { CAREERSIM_PLUGINS: '' });
    for (const dir of overlays()) expect(existsSync(dir)).toBe(false);
  });

  it('copies a local plugin into the api and web overlays', async () => {
    const env = { CAREERSIM_PLUGINS: 'demo', CAREERSIM_PLUGIN_DIR: fixtureDir };
    await run(join(apiRoot, 'scripts/plugins.mjs'), env);
    expect(existsSync(join(apiRoot, 'src/extensions/installed/demo/api/index.ts'))).toBe(true);
    expect(existsSync(join(apiRoot, 'src/extensions/installed/demo/shared/note.ts'))).toBe(true);
    expect(existsSync(join(apiRoot, 'dist/extensions/installed/demo/api/migrations/0000_init.sql'))).toBe(
      true,
    );
    expect(existsSync(join(apiRoot, 'src/extensions/installed/demo/web'))).toBe(false);

    await run(join(webRoot, 'scripts/plugins.mjs'), env);
    expect(existsSync(join(webRoot, 'src/extensions/installed/demo/web/index.ts'))).toBe(true);
    expect(existsSync(join(webRoot, 'src/extensions/installed/demo/shared/note.ts'))).toBe(true);
    expect(existsSync(join(webRoot, 'src/extensions/installed/index.ts'))).toBe(true);
    expect(existsSync(join(webRoot, 'src/app/(app)/(plugins)/demo/page.tsx'))).toBe(true);
    expect(existsSync(join(webRoot, 'src/app/(public)/(plugins)/p/[token]/page.tsx'))).toBe(true);
    expect(existsSync(join(webRoot, 'src/extensions/installed/demo/web/app'))).toBe(false);
  });

  it('fails closed on a bad apiVersion, a reserved id, or a missing token', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'careersim-plugin-bad-'));
    try {
      await mkdir(join(tmp, 'demo/api'), { recursive: true });
      await writeFile(join(tmp, 'demo/api/index.ts'), 'export default { id: "demo", apiVersion: 99 };\n');
      await writeFile(
        join(tmp, 'demo/plugin.json'),
        JSON.stringify({ id: 'demo', apiVersion: 99 }),
      );
      await expect(
        run(join(apiRoot, 'scripts/plugins.mjs'), {
          CAREERSIM_PLUGINS: 'demo',
          CAREERSIM_PLUGIN_DIR: tmp,
        }),
      ).rejects.toThrow(/apiVersion 99/);

      await expect(
        run(join(apiRoot, 'scripts/plugins.mjs'), {
          CAREERSIM_PLUGINS: 'sessions',
          CAREERSIM_PLUGIN_DIR: fixtureDir,
        }),
      ).rejects.toThrow(/collides/);

      await expect(
        run(join(apiRoot, 'scripts/plugins.mjs'), {
          CAREERSIM_PLUGINS: 'demo',
          CAREERSIM_PLUGIN_DIR: undefined,
          CAREERSIM_PLUGIN_REF: undefined,
          CAREERSIM_PLUGIN_TOKEN: undefined,
        }),
      ).rejects.toThrow(/CAREERSIM_PLUGIN_TOKEN/);

      await expect(
        run(
          join(apiRoot, 'scripts/plugins.mjs'),
          {
            CAREERSIM_PLUGINS: 'demo',
            CAREERSIM_PLUGIN_DIR: undefined,
          },
          'watch',
        ),
      ).rejects.toThrow(/CAREERSIM_PLUGIN_DIR/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('recopies a local plugin when its source changes', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'careersim-plugin-watch-'));
    await cp(fixtureDir, tmp, { recursive: true });
    const source = join(tmp, 'demo/api/index.ts');
    const installed = join(apiRoot, 'src/extensions/installed/demo/api/index.ts');
    const original = await readFile(source, 'utf8');
    let logs = '';
    const child = spawn(process.execPath, [join(apiRoot, 'scripts/plugins.mjs'), 'watch'], {
      env: {
        ...process.env,
        CAREERSIM_PLUGINS: 'demo',
        CAREERSIM_PLUGIN_DIR: tmp,
        CAREERSIM_DEV_POLL_MS: '50',
        CAREERSIM_PLUGIN_DEBOUNCE_MS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => {
      logs += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      logs += chunk.toString();
    });

    async function waitFor(check: () => boolean | Promise<boolean>) {
      const start = Date.now();
      while (Date.now() - start < 8_000) {
        if (child.exitCode !== null) {
          throw new Error(`watch exited ${child.exitCode}\n${logs}`);
        }
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(`timed out\n${logs}`);
    }

    try {
      await waitFor(async () => (await readFile(installed, 'utf8').catch(() => '')) === original);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await writeFile(source, `${original}\n// touched\n`);
      await waitFor(async () => (await readFile(installed, 'utf8').catch(() => '')).includes('// touched'));
    } finally {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        await exited;
      }
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
