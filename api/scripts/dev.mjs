/**
 * Development server.
 *
 * With CAREERSIM_PLUGIN_DIR set, plugins are copied from that directory
 * (no GitHub token) and the server restarts when their source changes.
 * The poll uses file mtimes, so it still notices saves through a Docker
 * bind mount. Without that directory, this is `plugins.mjs fetch` plus
 * `tsx watch`.
 */
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { fingerprintSources, pluginIds, syncPlugins, waitForSourceChange } from './plugins.mjs';

const execFileAsync = promisify(execFile);

function reportFailure(err) {
  if (err && typeof err === 'object') {
    const output = err;
    if (output.stdout) process.stdout.write(output.stdout);
    if (output.stderr) process.stderr.write(output.stderr);
  }
  console.error(err instanceof Error ? err.message : err);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let server;
let stopping = false;

function startServer() {
  server = spawn('pnpm', ['exec', 'tsx', 'watch', 'src/index.ts'], {
    cwd: root,
    stdio: 'inherit',
    detached: true,
  });
  server.on('exit', (code, signal) => {
    if (stopping || signal) return;
    process.exit(code ?? 0);
  });
}

function signalGroup(child, signal) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  signalGroup(child, 'SIGTERM');
  const exited = once(child, 'exit');
  const timedOut = sleep(2_000).then(() => false);
  const result = await Promise.race([exited.then(() => true), timedOut]);
  if (!result && child.exitCode === null) {
    signalGroup(child, 'SIGKILL');
    await once(child, 'exit');
  }
}

async function migrate() {
  await execFileAsync('pnpm', ['run', 'db:migrate'], { cwd: root, env: process.env });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  signalGroup(server, 'SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const ids = pluginIds();
const localDir = process.env.CAREERSIM_PLUGIN_DIR;

if (ids.length > 0) {
  await syncPlugins(ids);
  try {
    await migrate();
  } catch (err) {
    reportFailure(err);
    process.exit(1);
  }
}

startServer();

if (ids.length > 0 && localDir) {
  console.log(`plugins: watching ${localDir} (${ids.join(', ')})`);
  let previous = await fingerprintSources(ids);
  for (;;) {
    previous = await waitForSourceChange(previous, ids);
    if (stopping) break;
    console.log('plugins: source changed, reloading');
    stopping = true;
    await stopServer();
    stopping = false;
    try {
      await syncPlugins(ids);
      await migrate();
    } catch (err) {
      reportFailure(err);
      process.exit(1);
    }
    // Let the previous listen socket finish closing.
    await sleep(200);
    startServer();
  }
}
