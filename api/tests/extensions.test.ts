import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyPluginMigrations } from '../src/extensions/migrate.js';
import { EXTENSION_API_VERSION, type ApiPlugin } from '../src/extensions/sdk.js';
import { loadInstalledPlugins } from '../src/extensions/loader.js';
import fixturePlugin, { createdSessions } from './fixtures/installed/fixture/index.js';
import { buildTestApp, registerAndAuth, type TestHarness } from './helpers/build-test-app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const installedDir = resolve(__dirname, 'fixtures/installed');
const badDir = resolve(__dirname, 'fixtures/installed-bad');

describe('extensions', () => {
  let h: TestHarness | undefined;

  beforeEach(() => {
    createdSessions.length = 0;
  });

  afterEach(async () => {
    const current = h;
    h = undefined;
    if (current) await current.close();
  });

  it('loads nothing when the installed directory is missing', async () => {
    const plugins = await loadInstalledPlugins(resolve(__dirname, 'fixtures/no-such-plugins'));
    expect(plugins).toEqual([]);
  });

  it('loads a plugin directory and rejects a module that is not a plugin', async () => {
    const plugins = await loadInstalledPlugins(installedDir);
    expect(plugins.map((plugin) => plugin.id)).toEqual(['fixture']);
    expect(plugins[0]?.apiVersion).toBe(EXTENSION_API_VERSION);
    await expect(loadInstalledPlugins(badDir)).rejects.toThrow(/ApiPlugin/);
  });

  it('boots with no plugins and keeps catalog session creation on the agent', async () => {
    h = await buildTestApp();
    const { authHeader } = await registerAndAuth(h.app);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { simulation_slug: 'behavioral-interview-brenda' },
      headers: authHeader,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().simulation_title).toBe('Behavioral Interview');
    expect(h.agent.callLog).toContain('init:behavioral-interview-brenda');

    const missing = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { simulation_slug: 'fixture:open' },
      headers: authHeader,
    });
    expect(missing.statusCode).toBe(404);
    expect(h.agent.callLog.some((entry) => entry.startsWith('init:fixture'))).toBe(false);
  });

  it('serves plugin routes and provider-backed sessions', async () => {
    h = await buildTestApp({ plugins: [fixturePlugin] });
    const ping = await h.app.inject({ method: 'GET', url: '/v1/fixture/ping' });
    expect(ping.statusCode).toBe(200);
    expect(ping.json()).toEqual({ ok: true });

    const anon = await h.app.inject({ method: 'GET', url: '/v1/simulations/fixture:private' });
    expect(anon.statusCode).toBe(404);

    const { authHeader, userId } = await registerAndAuth(h.app);
    const detail = await h.app.inject({
      method: 'GET',
      url: '/v1/simulations/fixture:private',
      headers: authHeader,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().title).toBe('Fixture sim');
    expect(h.agent.callLog.some((entry) => entry.startsWith('getSimulation:'))).toBe(false);

    const created = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { simulation_slug: 'fixture:open' },
      headers: authHeader,
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.simulation_slug).toBe('fixture:open');
    expect(body.simulation_title).toBe('Fixture sim');
    expect(body.messages.map((message: { content: string }) => message.content)).toEqual([
      'proactive:start',
    ]);
    expect(h.agent.callLog).toContain('proactive:start');
    expect(h.agent.callLog.some((entry) => entry.startsWith('init:'))).toBe(false);
    expect(createdSessions).toEqual([
      { slug: 'fixture:open', userId, sessionId: body.id },
    ]);

    const listed = await h.app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: authHeader,
    });
    expect(listed.json().sessions[0].simulation_title).toBe('Fixture sim');

    const avatar = await h.app.inject({
      method: 'GET',
      url: '/v1/personas/fixture:open/avatar',
    });
    expect(avatar.statusCode).toBe(404);
    expect(h.agent.callLog.some((entry) => entry.startsWith('getPersonaAvatar:'))).toBe(false);
  });

  it('applies plugin migrations in their own schema on PGlite', async () => {
    h = await buildTestApp();
    await applyPluginMigrations(h.db.db, [fixturePlugin], migrate);
    await applyPluginMigrations(h.db.db, [fixturePlugin], migrate);
    const rows = await h.db.db.execute(sql`select id from extfix.markers`);
    expect(rows.rows).toEqual([{ id: 'applied' }]);
  });

  it('refuses a plugin that collides with a host route or targets another api version', async () => {
    const collision: ApiPlugin = { id: 'sessions', apiVersion: 1 };
    await expect(buildTestApp({ plugins: [collision] })).rejects.toThrow(/collides/);
    const stale: ApiPlugin = { id: 'fixture', apiVersion: 99 };
    await expect(buildTestApp({ plugins: [stale] })).rejects.toThrow(/apiVersion 99/);
  });
});
