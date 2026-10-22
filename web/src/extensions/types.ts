/**
 * Host contract for build-time web plugins.
 *
 * Plugin pages are copied into `src/app/(app)/(plugins)/` and
 * `src/app/(public)/(plugins)/` before `next build`. Those nested route
 * groups inherit the signed-in and public layouts, so the host does not
 * register their URLs itself. The registry module (`@careersim/plugins`)
 * only carries data: nav items, link overrides, and robots rules. It must
 * not import client components.
 */

export interface WebNavItem {
  href: string;
  label: string;
}

export interface WebPlugin {
  id: string;
  /** Appended to the signed-in navbar. Guests do not see these. */
  navItems: WebNavItem[];
  /**
   * Override the link for a simulation slug. Return null to keep the host
   * catalogue URL (`/simulations/<slug>`).
   */
  simulationHref?: (slug: string) => string | null;
  /** Paths added to `robots.txt` disallow. Plugin pages are not public catalogue. */
  robotsDisallow?: string[];
}
