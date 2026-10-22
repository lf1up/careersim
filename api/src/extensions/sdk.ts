/**
 * Host contract for build-time plugins.
 *
 * A plugin is copied into `src/extensions/installed/<id>/` before `tsc`
 * (see `scripts/plugins.mjs`). The host never imports creator-specific
 * code: it only loads whatever that directory contains, and tests inject
 * plugins through `buildApp({ plugins })`.
 *
 * Routes mount at `{versionPrefix}/{plugin.id}`. Simulation slugs the
 * plugin owns use `<namespace>:<id>`. Catalog slugs cannot contain `:`,
 * so the two spaces do not collide.
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AgentClient } from '../agent/client.js';
import type { AgentSimulationDetail, AgentWireState } from '../agent/types.js';
import type { AppDatabase } from '../db/client.js';

export const EXTENSION_API_VERSION = 1;

/**
 * Services a plugin route handler may use. Plugins should import host
 * helpers from this module rather than reaching into `src/` paths that
 * can move.
 */
export interface ApiPluginContext {
  db: AppDatabase;
  agent: AgentClient;
  /** Rejects the request with 401 when the cookie or bearer token is missing. */
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  logger: FastifyBaseLogger;
}

/**
 * Resolves slugs shaped `<namespace>:<id>` without asking the agent catalog.
 * `prepareSession` returns the wire state the host stores on the new session.
 * When that state has `proactive_trigger === 'start'`, the host runs
 * `agent.proactive('start')` itself — the same step `/conversation/init` does
 * for catalog simulations.
 */
export interface SimulationProvider {
  namespace: string;
  getDetail(args: { slug: string; userId: string | null }): Promise<AgentSimulationDetail | null>;
  prepareSession(args: { slug: string; userId: string }): Promise<{ state: AgentWireState }>;
  onSessionCreated?(args: { slug: string; userId: string; sessionId: string }): Promise<void>;
}

export interface ApiPlugin {
  /** Route prefix. Mounted at `{versionPrefix}/{id}`. */
  id: string;
  /** Must equal {@link EXTENSION_API_VERSION} or the host refuses to boot. */
  apiVersion: number;
  routes?: (scope: FastifyInstance, ctx: ApiPluginContext) => Promise<void>;
  /** Owns slugs `<namespace>:<id>`. */
  simulations?: SimulationProvider;
  /**
   * SQL migrations applied after the core ones, in their own Postgres schema
   * (and therefore their own migrations table). `folder` is an absolute path
   * to a drizzle-kit migrations directory.
   */
  migrations?: { folder: string; schema: string };
}

const NAMESPACED_SLUG = /^([a-z][a-z0-9-]{0,62}):([^:]+)$/;

/** Split a `<namespace>:<id>` slug. Returns null for catalog slugs. */
export function parseNamespacedSlug(slug: string): { namespace: string; id: string } | null {
  const match = NAMESPACED_SLUG.exec(slug);
  if (!match?.[1] || !match[2]) return null;
  return { namespace: match[1], id: match[2] };
}

export function simulationProviders(plugins: readonly ApiPlugin[]): SimulationProvider[] {
  return plugins.flatMap((plugin) => (plugin.simulations ? [plugin.simulations] : []));
}

/** Provider for a namespaced slug, or null when the slug is a catalog slug or unknown. */
export function providerForSlug(
  providers: readonly SimulationProvider[],
  slug: string,
): SimulationProvider | null {
  const parsed = parseNamespacedSlug(slug);
  if (!parsed) return null;
  return providers.find((provider) => provider.namespace === parsed.namespace) ?? null;
}

const RESERVED_PLUGIN_IDS = new Set([
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

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * Fail closed before routes are registered: bad apiVersion, duplicate ids,
 * ids that would shadow a host route, or two providers for one namespace.
 */
export function assertPluginRegistry(plugins: readonly ApiPlugin[]): void {
  const ids = new Set<string>();
  const namespaces = new Set<string>();
  for (const plugin of plugins) {
    if (!PLUGIN_ID.test(plugin.id)) {
      throw new Error(`Plugin id "${plugin.id}" must be a lowercase slug`);
    }
    if (plugin.apiVersion !== EXTENSION_API_VERSION) {
      throw new Error(
        `Plugin "${plugin.id}" targets apiVersion ${plugin.apiVersion}; this host is ${EXTENSION_API_VERSION}`,
      );
    }
    if (ids.has(plugin.id) || RESERVED_PLUGIN_IDS.has(plugin.id)) {
      throw new Error(`Plugin id "${plugin.id}" collides with another route`);
    }
    ids.add(plugin.id);
    if (plugin.simulations) {
      if (!PLUGIN_ID.test(plugin.simulations.namespace)) {
        throw new Error(
          `Plugin "${plugin.id}" simulation namespace "${plugin.simulations.namespace}" must be a lowercase slug`,
        );
      }
      if (namespaces.has(plugin.simulations.namespace)) {
        throw new Error(
          `Simulation namespace "${plugin.simulations.namespace}" is claimed by two plugins`,
        );
      }
      namespaces.add(plugin.simulations.namespace);
    }
  }
}

export { users, sessions, messages } from '../db/schema.js';
export type { AppDatabase } from '../db/client.js';
export type { AgentClient } from '../agent/client.js';
export type {
  AgentConversationResponse,
  AgentSimulationDetail,
  AgentWireState,
} from '../agent/types.js';
export { HttpError, badRequest, conflict, forbidden, notFound } from '../plugins/errors.js';
export { perUserLimit, rateLimitPolicy } from '../plugins/rate-limit.js';
export type { RouteRateLimit } from '../plugins/rate-limit.js';
