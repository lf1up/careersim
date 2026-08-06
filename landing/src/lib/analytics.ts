/**
 * Absolute Web Analytics endpoints for the landing Astro deploy.
 *
 * Production serves marketing HTML through the apex `web` rewrite. Relative
 * paths like `/<hash>/script.js` then resolve on careersim.ai and 404 —
 * that hash only exists on the landing Vercel project. Point the script and
 * intake URLs at this deployment's own origin instead (Vercel multi-project
 * guidance: https://vercel.com/docs/analytics/package).
 */
export function landingAnalyticsProps(): {
  scriptSrc?: string;
  eventEndpoint?: string;
  viewEndpoint?: string;
} {
  const host = import.meta.env.VERCEL_URL?.trim();
  if (!host) return {};

  const origin = /^https?:\/\//i.test(host)
    ? host.replace(/\/$/, '')
    : `https://${host}`;

  try {
    const raw = import.meta.env.PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG;
    if (typeof raw === 'string' && raw) {
      const parsed = JSON.parse(raw) as {
        analytics?: {
          scriptSrc?: string;
          eventEndpoint?: string;
          viewEndpoint?: string;
        };
      };
      const analytics = parsed.analytics;
      if (analytics?.scriptSrc) {
        return {
          scriptSrc: new URL(analytics.scriptSrc, `${origin}/`).href,
          eventEndpoint: analytics.eventEndpoint
            ? new URL(analytics.eventEndpoint, `${origin}/`).href
            : undefined,
          viewEndpoint: analytics.viewEndpoint
            ? new URL(analytics.viewEndpoint, `${origin}/`).href
            : undefined,
        };
      }
    }
  } catch {
    // Fall through to basePath / classic insights paths.
  }

  const base = import.meta.env.PUBLIC_VERCEL_OBSERVABILITY_BASEPATH?.trim();
  if (base) {
    const root = base.startsWith('/') ? base.replace(/\/$/, '') : `/${base.replace(/\/$/, '')}`;
    return {
      scriptSrc: `${origin}${root}/script.js`,
      eventEndpoint: `${origin}${root}/event`,
      viewEndpoint: `${origin}${root}/view`,
    };
  }

  return {
    scriptSrc: `${origin}/_vercel/insights/script.js`,
    eventEndpoint: `${origin}/_vercel/insights/event`,
    viewEndpoint: `${origin}/_vercel/insights/view`,
  };
}
