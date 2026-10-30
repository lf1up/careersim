import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyPluginMigrations } from '../src/extensions/migrate.js';
import { messages, sessions } from '../src/db/schema.js';
import { EXTENSION_API_VERSION, type ApiPlugin } from '../src/extensions/sdk.js';
import { loadInstalledPlugins } from '../src/extensions/loader.js';
import { sessionsRoutes } from '../src/modules/sessions/sessions.route.js';
import { simulationsRoutes } from '../src/modules/simulations/simulations.route.js';
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

  it('skips loose files and rejects a plugin directory with no entry', async () => {
    const filesOnly = await mkdtemp(join(tmpdir(), 'plugins-'));
    const noEntry = await mkdtemp(join(tmpdir(), 'plugins-'));
    try {
      await writeFile(join(filesOnly, 'readme.txt'), 'skip');
      await expect(loadInstalledPlugins(filesOnly)).resolves.toEqual([]);

      await mkdir(join(noEntry, 'orphan'));
      await expect(loadInstalledPlugins(noEntry)).rejects.toThrow(
        /no index\.ts or api\/index\.ts/,
      );
    } finally {
      await rm(filesOnly, { recursive: true, force: true });
      await rm(noEntry, { recursive: true, force: true });
    }
  });

  it('accepts a named plugin export and rejects null or primitive exports', async () => {
    const named = await loadInstalledPlugins(resolve(__dirname, 'fixtures/loader/named-root'));
    expect(named.map((plugin) => plugin.id)).toEqual(['named']);
    await expect(
      loadInstalledPlugins(resolve(__dirname, 'fixtures/loader/nullish-root')),
    ).rejects.toThrow(/ApiPlugin/);
    await expect(
      loadInstalledPlugins(resolve(__dirname, 'fixtures/loader/primitive-root')),
    ).rejects.toThrow(/ApiPlugin/);
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

  it('rolls back session, transcript, and provider writes when the creation hook fails', async () => {
    let failHook = true;
    const plugin: ApiPlugin = {
      ...fixturePlugin,
      simulations: {
        ...fixturePlugin.simulations!,
        async onSessionCreated({ sessionId, db }) {
          const [session] = await db.select().from(sessions);
          expect(session?.id).toBe(sessionId);
          expect(await db.select().from(messages)).toHaveLength(1);
          await db.execute(sql`insert into extfix.markers (id) values ('hook')`);
          if (failHook) throw new Error('Provider unavailable');
        },
      },
    };
    h = await buildTestApp({ plugins: [plugin] });
    await applyPluginMigrations(h.db.db, [plugin], migrate);
    const { authHeader } = await registerAndAuth(h.app);
    const create = () => h!.app.inject({
      method: 'POST', url: '/v1/sessions', headers: authHeader,
      payload: { simulation_slug: 'fixture:open' },
    });
    expect((await create()).statusCode).toBe(500);
    expect(await h.db.db.select().from(sessions)).toEqual([]);
    expect(await h.db.db.select().from(messages)).toEqual([]);
    expect((await h.db.db.execute(sql`select id from extfix.markers`)).rows).toEqual([{ id: 'applied' }]);
    failHook = false;
    const retry = await create();
    expect(retry.statusCode, retry.body).toBe(201);
    expect(await h.db.db.select().from(sessions)).toHaveLength(1);
    expect(await h.db.db.select().from(messages)).toHaveLength(1);
    expect((await h.db.db.execute(sql`select id from extfix.markers where id = 'hook'`)).rows).toHaveLength(1);
  });

  it('skips plugins that do not ship migrations', async () => {
    const seen: string[] = [];
    await applyPluginMigrations(
      null as never,
      [{ id: 'bare', apiVersion: 1 }, fixturePlugin],
      async (_db, config) => {
        seen.push(config.migrationsSchema ?? '');
      },
    );
    expect(seen).toEqual(['extfix']);
  });

  it('stores a provider session that does not ask for a proactive start', async () => {
    const quiet: ApiPlugin = {
      id: 'quiet',
      apiVersion: EXTENSION_API_VERSION,
      simulations: {
        namespace: 'quiet',
        async getDetail() {
          return null;
        },
        async prepareSession({ slug }) {
          if (slug === 'quiet:seeded') {
            return {
              state: {
                simulation: { slug, title: 'Quiet' },
                messages: [{ role: 'ai', content: 'seeded' }],
                goal_progress: [{ goalNumber: 1, status: 'not_started' }],
              },
            };
          }
          return { state: { simulation: { slug, title: 'Quiet' } } };
        },
      },
    };
    h = await buildTestApp({ plugins: [quiet] });
    const { authHeader } = await registerAndAuth(h.app);

    const seeded = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { simulation_slug: 'quiet:seeded' },
      headers: authHeader,
    });
    expect(seeded.statusCode, seeded.body).toBe(201);
    expect(seeded.json().messages.map((message: { content: string }) => message.content)).toEqual([
      'seeded',
    ]);
    expect(seeded.json().goal_progress).toEqual([{ goalNumber: 1, status: 'not_started' }]);

    const bare = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { simulation_slug: 'quiet:bare' },
      headers: authHeader,
    });
    expect(bare.statusCode, bare.body).toBe(201);
    expect(bare.json().messages).toEqual([]);
    expect(bare.json().goal_progress).toEqual([]);
    expect(
      h.agent.callLog.some((entry) => entry.startsWith('proactive:') || entry.startsWith('init:')),
    ).toBe(false);
  });

  it('defaults simulation providers to none when the option is omitted', async () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => {});
    await app.register(simulationsRoutes, {
      agent: {
        listSimulations: async () => ({ simulations: [] }),
        getSimulation: async () => {
          throw new Error('catalog lookup should not run');
        },
      } as never,
    });
    await app.register(sessionsRoutes, { db: {} as never, agent: {} as never });
    const missing = await app.inject({
      method: 'GET',
      url: '/simulations/fixture:missing',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: 'simulation_not_found',
      message: 'Simulation "fixture:missing" was not found.',
    });
    await app.close();
  });

  it('refuses a plugin that collides with a host route or targets another api version', async () => {
    const collision: ApiPlugin = { id: 'sessions', apiVersion: 1 };
    await expect(buildTestApp({ plugins: [collision] })).rejects.toThrow(/collides/);
    const stale: ApiPlugin = { id: 'fixture', apiVersion: 99 };
    await expect(buildTestApp({ plugins: [stale] })).rejects.toThrow(/apiVersion 99/);
  });
});
