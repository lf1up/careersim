import { plugins as installedPlugins } from '@careersim/plugins';

import type { WebNavItem, WebPlugin } from './types';

export type { WebNavItem, WebPlugin } from './types';

/** Plugins discovered at build time. Empty unless `CAREERSIM_PLUGINS` was set. */
export const plugins: readonly WebPlugin[] = installedPlugins;

export function mergeNavItems(base: readonly WebNavItem[], extra: readonly WebPlugin[]): WebNavItem[] {
  return [...base, ...extra.flatMap((plugin) => plugin.navItems)];
}

/**
 * The creator "Create" action belongs beside the simulations search, not in
 * the global navbar. Match the plugin href so other plugin links stay in nav.
 */
const CATALOGUE_ACTION_HREFS = new Set(['/create']);

export function isCatalogueAction(item: WebNavItem): boolean {
  return CATALOGUE_ACTION_HREFS.has(item.href);
}

/** Plugin links rendered next to the simulations search. */
export function catalogueActions(extra: readonly WebPlugin[] = plugins): WebNavItem[] {
  return extra.flatMap((plugin) => plugin.navItems).filter(isCatalogueAction);
}

/** Signed-in navbar: host items, then plugin items that are not catalogue actions. */
export function signedInNavItems(base: readonly WebNavItem[]): WebNavItem[] {
  return mergeNavItems(base, plugins).filter((item) => !isCatalogueAction(item));
}

export function simulationHrefFor(slug: string, list: readonly WebPlugin[]): string {
  for (const plugin of list) {
    const href = plugin.simulationHref?.(slug);
    if (href) return href;
  }
  return `/simulations/${encodeURIComponent(slug)}`;
}

/** Link target for a simulation slug, after plugin overrides. */
export function simulationHref(slug: string): string {
  return simulationHrefFor(slug, plugins);
}

export function pluginRobotsDisallow(list: readonly WebPlugin[] = plugins): string[] {
  return list.flatMap((plugin) => plugin.robotsDisallow ?? []);
}

/**
 * Title to show for a session or analytics row. Catalogue title wins when
 * the public catalogue knows the slug; otherwise the snapshot title; otherwise
 * the raw slug.
 */
export function simulationLabel(
  slug: string,
  options?: { title?: string | null; catalogTitle?: string | null },
): string {
  return options?.catalogTitle || options?.title || slug;
}
