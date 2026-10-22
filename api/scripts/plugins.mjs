/**
 * Copy build-time plugins into this package.
 *
 * CAREERSIM_PLUGINS unset: every command exits 0 and writes nothing.
 * CAREERSIM_PLUGIN_DIR:    copy plugins/<id> from that directory (local dev, CI).
 * Otherwise:               download the careersim-studio tarball at
 *                          CAREERSIM_PLUGIN_REF with CAREERSIM_PLUGIN_TOKEN
 *                          and extract plugins/<id>.
 *
 * `watch` requires CAREERSIM_PLUGIN_DIR. It copies once, then polls that
 * directory and copies again when the plugin source changes. Development
 * uses this instead of the GitHub token. Set CAREERSIM_PLUGIN_WATCH_SKIP_INITIAL=1
 * to poll only (the caller already copied).
 *
 * A configured plugin that cannot be fetched, whose plugin.json apiVersion
 * is not 1, or whose id collides with a host route fails the build.
 *
 * The same file lives in api/scripts and web/scripts. Keep the two copies
 * in sync. Host behavior differs only by which package directory contains
 * next.config.mjs.
 */
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const EXTENSION_API_VERSION = 1;
const REPO = 'lf1up/careersim-studio';
const RESERVED_IDS = new Set([
  'auth',
  'simulations',
  'personas',
  'sessions',
  'analytics',
  'voice',
  'health',
  'docs',
  'internal',
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = existsSync(join(root, 'next.config.mjs')) ? 'web' : 'api';
const SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.next',
  '.turbo',
  '.DS_Store',
]);

function fail(message) {
  console.error(`plugins: ${message}`);
  process.exit(1);
}

export function pluginIds() {
  return (process.env.CAREERSIM_PLUGINS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function pollInterval() {
  const value = Number(process.env.CAREERSIM_DEV_POLL_MS ?? 400);
  return Number.isFinite(value) && value >= 50 ? value : 400;
}

function debounceMs() {
  const value = Number(process.env.CAREERSIM_PLUGIN_DEBOUNCE_MS ?? 200);
  return Number.isFinite(value) && value >= 0 ? value : 200;
}

export async function syncPlugins(ids = pluginIds()) {
  if (ids.length === 0) return;
  await installPlugins(ids);
  if (host === 'api') await copySqlAssets();
}

/** Fingerprint of the local plugin source. Empty when a path is missing. */
export async function fingerprintSources(ids = pluginIds()) {
  const localRoot = process.env.CAREERSIM_PLUGIN_DIR;
  if (!localRoot) fail('fingerprint requires CAREERSIM_PLUGIN_DIR');
  const parts = [];
  for (const id of ids) {
    const dir = resolve(localRoot, id);
    parts.push(await fingerprintPath(join(dir, 'plugin.json')));
    for (const name of ['api', 'shared', 'web']) {
      parts.push(await fingerprintPath(join(dir, name)));
    }
  }
  return parts.join('\n');
}

/**
 * Resolves on the next settled change. A burst of writes (one save touching
 * several files) collapses into a single result.
 */
export async function waitForSourceChange(previous, ids = pluginIds()) {
  const debounce = debounceMs();
  for (;;) {
    await sleep(pollInterval());
    const next = await fingerprintSources(ids);
    if (next === previous) continue;
    if (debounce) await sleep(debounce);
    const settled = await fingerprintSources(ids);
    if (settled === previous) continue;
    return settled;
  }
}

async function fingerprintPath(path) {
  if (!existsSync(path)) return '';
  const info = await stat(path);
  if (info.isFile()) return `${path}:${info.mtimeMs}:${info.size}`;
  if (!info.isDirectory()) return '';
  const parts = [];
  await walk(path, parts);
  return parts.join('\n');
}

async function walk(directory, parts) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, parts);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(path);
    parts.push(`${path}:${info.mtimeMs}:${info.size}`);
  }
}

async function watchPlugins(ids) {
  const skipInitial = process.env.CAREERSIM_PLUGIN_WATCH_SKIP_INITIAL === '1';
  if (!skipInitial) await syncPlugins(ids);
  let previous = await fingerprintSources(ids);
  for (;;) {
    previous = await waitForSourceChange(previous, ids);
    console.log('plugins: source changed, copying');
    await syncPlugins(ids);
  }
}

async function main() {
  const command = process.argv[2];
  if (!['fetch', 'sync', 'assets', 'watch'].includes(command)) {
    fail('usage: plugins.mjs <fetch|sync|assets|watch>');
  }
  const ids = pluginIds();
  if (ids.length === 0) return;

  if (command === 'assets') {
    await copySqlAssets();
    return;
  }
  if ((command === 'sync' || command === 'watch') && !process.env.CAREERSIM_PLUGIN_DIR) {
    fail(`${command} requires CAREERSIM_PLUGIN_DIR`);
  }
  if (command === 'watch') {
    await watchPlugins(ids);
    return;
  }
  await syncPlugins(ids);
}

async function installPlugins(ids) {
  const seen = new Set();
  const sources = [];
  for (const id of ids) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) fail(`plugin id "${id}" must be a lowercase slug`);
    if (seen.has(id) || RESERVED_IDS.has(id)) fail(`plugin id "${id}" collides with another route`);
    seen.add(id);
    const source = await resolveSource(id);
    const meta = await readPluginJson(source, id);
    if (meta.apiVersion !== EXTENSION_API_VERSION) {
      fail(
        `plugin "${id}" targets apiVersion ${meta.apiVersion}; this host is ${EXTENSION_API_VERSION}`,
      );
    }
    if (host === 'web' && !existsSync(join(source, 'web/index.ts')) && !existsSync(join(source, 'web/index.tsx'))) {
      fail(`plugin "${id}" is missing web/index.ts`);
    }
    sources.push({ id, source });
  }

  if (host === 'api') {
    await rm(join(root, 'src/extensions/installed'), { recursive: true, force: true });
    for (const { id, source } of sources) {
      const dest = join(root, 'src/extensions/installed', id);
      await mkdir(dest, { recursive: true });
      await cp(join(source, 'api'), join(dest, 'api'), { recursive: true });
      await copyIfExists(join(source, 'shared'), join(dest, 'shared'));
      await cp(join(source, 'plugin.json'), join(dest, 'plugin.json'));
    }
    return;
  }

  await rm(join(root, 'src/extensions/installed'), { recursive: true, force: true });
  await rm(join(root, 'src/app/(app)/(plugins)'), { recursive: true, force: true });
  await rm(join(root, 'src/app/(public)/(plugins)'), { recursive: true, force: true });
  const written = new Set();
  for (const { id, source } of sources) {
    const dest = join(root, 'src/extensions/installed', id);
    await mkdir(join(dest, 'web'), { recursive: true });
    await copyChildren(join(source, 'web'), join(dest, 'web'), (name) => name !== 'app');
    await copyPages(join(source, 'web/app/(app)'), join(root, 'src/app/(app)/(plugins)'), written);
    await copyPages(join(source, 'web/app/(public)'), join(root, 'src/app/(public)/(plugins)'), written);
  }
  await writeWebRegistry(ids);
}

async function resolveSource(id) {
  const localRoot = process.env.CAREERSIM_PLUGIN_DIR;
  if (localRoot) {
    const dir = resolve(localRoot, id);
    if (!existsSync(join(dir, 'plugin.json'))) {
      fail(`CAREERSIM_PLUGIN_DIR has no plugins/${id}/plugin.json (${dir})`);
    }
    return dir;
  }
  const ref = process.env.CAREERSIM_PLUGIN_REF;
  const token = process.env.CAREERSIM_PLUGIN_TOKEN;
  if (!ref || !token) {
    fail('CAREERSIM_PLUGIN_REF and CAREERSIM_PLUGIN_TOKEN are required when CAREERSIM_PLUGIN_DIR is unset');
  }
  return downloadPlugin(id, ref, token);
}

async function downloadPlugin(id, ref, token) {
  const url = `https://api.github.com/repos/${REPO}/tarball/${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'careersim-plugins',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok || !response.body) {
    fail(`download of ${REPO}@${ref} failed (${response.status})`);
  }
  const tmp = await mkdtemp(join(tmpdir(), 'careersim-plugin-'));
  const archive = join(tmp, 'repo.tar.gz');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  await execFileAsync('tar', ['-xzf', archive, '-C', tmp]);
  const entries = await readdir(tmp);
  const top = entries.find((name) => name !== 'repo.tar.gz');
  if (!top) fail(`tarball of ${REPO}@${ref} was empty`);
  const pluginDir = join(tmp, top, 'plugins', id);
  if (!existsSync(join(pluginDir, 'plugin.json'))) {
    fail(`tarball ${REPO}@${ref} has no plugins/${id}`);
  }
  return pluginDir;
}

async function readPluginJson(source, id) {
  const file = join(source, 'plugin.json');
  let meta;
  try {
    meta = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    fail(`could not read ${file}: ${err instanceof Error ? err.message : err}`);
  }
  if (meta.id !== id) fail(`plugin.json id "${meta.id}" does not match requested id "${id}"`);
  if (typeof meta.apiVersion !== 'number') fail(`plugin "${id}" plugin.json is missing apiVersion`);
  if (!existsSync(join(source, 'api/index.ts')) && !existsSync(join(source, 'api/index.js'))) {
    fail(`plugin "${id}" is missing api/index.ts`);
  }
  return meta;
}

async function copyIfExists(from, to) {
  if (!existsSync(from)) return;
  await cp(from, to, { recursive: true });
}

async function copyChildren(from, to, include) {
  if (!existsSync(from)) fail(`missing ${from}`);
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (!include(entry.name)) continue;
    await cp(join(from, entry.name), join(to, entry.name), { recursive: true });
  }
}

async function copyPages(from, to, written) {
  if (!existsSync(from)) return;
  await mkdir(to, { recursive: true });
  await copyTreeChecked(from, to, written);
}

async function copyTreeChecked(from, to, written) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      await mkdir(dest, { recursive: true });
      await copyTreeChecked(src, dest, written);
      continue;
    }
    const key = relative(root, dest);
    if (written.has(key)) fail(`plugin pages collide at ${key}`);
    written.add(key);
    await cp(src, dest);
  }
}

async function writeWebRegistry(ids) {
  const lines = ids.map(
    (id) => `import { plugin as ${ident(id)} } from './${id}/web/index';`,
  );
  lines.push('');
  lines.push(`export const plugins = [${ids.map(ident).join(', ')}];`);
  lines.push('');
  const dest = join(root, 'src/extensions/installed/index.ts');
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, lines.join('\n'));
}

function ident(id) {
  const name = id.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
  return /^[a-z]/.test(name) ? name : `plugin${name}`;
}

async function copySqlAssets() {
  const installed = join(root, 'src/extensions/installed');
  if (!existsSync(installed)) return;
  await copyMatching(installed, join(root, 'dist/extensions/installed'));
}

async function copyMatching(from, to) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyMatching(src, dest);
      continue;
    }
    if (!entry.name.endsWith('.sql') && entry.name !== '_journal.json') continue;
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
