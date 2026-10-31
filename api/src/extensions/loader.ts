import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type ApiPlugin, assertPluginRegistry } from './sdk.js';

/**
 * Load plugins copied into `installed/<id>/` next to this module.
 *
 * Missing directory means "no plugins configured" and returns `[]`, so a
 * stock build behaves exactly as before. A present directory that fails to
 * import, or that fails {@link assertPluginRegistry}, rejects — a configured
 * plugin that cannot load must not boot as if it were absent.
 */
export async function loadInstalledPlugins(dir?: string): Promise<ApiPlugin[]> {
  const root = dir ?? fileURLToPath(new URL('./installed/', import.meta.url));
  if (!existsSync(root)) return [];

  const entries = await readdir(root, { withFileTypes: true });
  const plugins: ApiPlugin[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = join(root, entry.name);
    const imported = await importPlugin(pluginDir);
    const plugin = resolvePluginExport(imported, pluginDir);
    plugins.push(plugin);
  }
  assertPluginRegistry(plugins);
  return plugins;
}

async function importPlugin(pluginDir: string): Promise<Record<string, unknown>> {
  // `api/index` is the overlay layout: the fetch script copies a plugin's
  // `api/` and `shared/` trees and leaves `api/index.ts` as the entry so
  // `../shared` imports keep working. A root `index` still wins when a
  // plugin provides one.
  for (const name of ['index.js', 'index.ts', 'api/index.js', 'api/index.ts']) {
    const file = join(pluginDir, name);
    if (!existsSync(file)) continue;
    return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  }
  throw new Error(`Plugin at ${pluginDir} has no index.ts or api/index.ts`);
}

function resolvePluginExport(imported: Record<string, unknown>, pluginDir: string): ApiPlugin {
  const candidate = imported.default ?? imported.plugin;
  if (!isPlugin(candidate)) {
    throw new Error(`Plugin at ${pluginDir} must default-export an ApiPlugin`);
  }
  return candidate;
}

function isPlugin(value: unknown): value is ApiPlugin {
  if (!value || typeof value !== 'object') return false;
  const plugin = value as Partial<ApiPlugin>;
  return typeof plugin.id === 'string' && typeof plugin.apiVersion === 'number';
}
