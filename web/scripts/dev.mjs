/**
 * Next.js dev server.
 *
 * With CAREERSIM_PLUGIN_DIR set, plugins are copied from that directory
 * first (no GitHub token). A watcher recopies them when the source
 * changes; Next picks the new files up through its own file watcher.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let shuttingDown = false;
let watcher;
let next;

function run(command, args, env = process.env) {
  return spawn(command, args, { cwd: root, stdio: 'inherit', env, detached: true });
}

function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stop(watcher);
  stop(next);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const fetch = run(process.execPath, ['scripts/plugins.mjs', 'fetch']);
const [fetchCode] = await once(fetch, 'exit');
if (fetchCode !== 0) process.exit(fetchCode ?? 1);

const ids = (process.env.CAREERSIM_PLUGINS ?? '').trim();
if (process.env.CAREERSIM_PLUGIN_DIR && ids) {
  watcher = run(process.execPath, ['scripts/plugins.mjs', 'watch'], {
    ...process.env,
    CAREERSIM_PLUGIN_WATCH_SKIP_INITIAL: '1',
  });
  watcher.on('exit', (code, signal) => {
    if (shuttingDown || signal) return;
    process.exit(code ?? 1);
  });
  console.log(`plugins: watching ${process.env.CAREERSIM_PLUGIN_DIR} (${ids})`);
}

next = run('pnpm', ['exec', 'next', 'dev', '--turbopack', '--port', '3000']);
const [code] = await once(next, 'exit');
if (!shuttingDown) process.exit(code ?? 0);
