/**
 * Apex proxy for the Astro landing deployment.
 *
 * Vercel Standard Protection on the landing project injects
 * `x-robots-tag: noindex`. Next.js `rewrites()` to LANDING_ORIGIN would
 * forward that header onto careersim.ai and block indexing of `/`,
 * `/business`, and the legal pages. The proxy fetches the origin and
 * strips `x-robots-tag` before the response reaches the client.
 *
 * Contact form APIs (`/api/altcha-challenge`, `/api/contact`) stay on
 * this Next app so they share the apex challenge session.
 */

export const LANDING_PROXY_EXACT_PATHS = [
  '/',
  '/business',
  '/privacy',
  '/terms',
  '/security',
  '/favicon.svg',
] as const;

export const LANDING_PROXY_PREFIXES = ['/_astro/', '/avatars/'] as const;

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
] as const;

export function isLandingProxyPath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

  if ((LANDING_PROXY_EXACT_PATHS as readonly string[]).includes(normalized)) {
    return true;
  }

  return LANDING_PROXY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function buildLandingOriginUrl(
  origin: string,
  pathname: string,
  search = '',
): URL {
  const url = new URL(origin.replace(/\/$/, ''));
  url.pathname = pathname;
  url.search = search.startsWith('?') ? search.slice(1) : search;
  return url;
}

/**
 * Outgoing request headers for the landing fetch. Drops Host and any
 * client-supplied bypass header, then sets the server secret if present.
 */
export function requestHeadersForLanding(
  source: Headers,
  bypassSecret?: string,
): Headers {
  const headers = new Headers(source);
  headers.delete('host');
  headers.delete('cookie');
  headers.delete('connection');
  headers.delete('content-length');
  headers.delete('x-vercel-protection-bypass');
  const bypass = bypassSecret?.trim();
  if (bypass) {
    headers.set('x-vercel-protection-bypass', bypass);
  }
  // Avoid gzip/br so we can stream the decoded body without a stale
  // Content-Encoding header from the origin.
  headers.set('accept-encoding', 'identity');
  return headers;
}

/**
 * Copy landing response headers for the apex, dropping the protection
 * `noindex` that Vercel stamps on the origin.
 */
export function headersForApexFromLanding(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete('x-robots-tag');
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  // Same guards as `headers()` in next.config.mjs — proxy-generated
  // responses may skip that merge.
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(self), geolocation=()',
  );
  headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains',
  );
  headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  return headers;
}
