const landingOrigin = process.env.LANDING_ORIGIN?.replace(/\/$/, '');

// Public API origin — used by `next/image` so the optimizer is allowed to
// fetch persona avatars from the API service. We accept both the
// browser-visible URL (`NEXT_PUBLIC_API_URL`) and an optional internal one
// (`API_INTERNAL_URL`, used by Docker compose) so the same URL passed to
// `<Image src="...">` can be reached from the Next server when it streams
// the original through the optimizer at `/_next/image`.
const apiUrls = [process.env.NEXT_PUBLIC_API_URL, process.env.API_INTERNAL_URL]
  .filter(Boolean)
  // Always allow localhost:8000 in dev when no envs are set.
  .concat('http://localhost:8000');

// Ghost Content API / asset origin. Include both the compose-internal URL
// (`http://ghost:2368`) and the browser-facing URL (`http://localhost:2368`
// or prod `https://ghost.careersim.ai`) so `next/image` can optimize feature
// images regardless of which host Ghost stamps into `feature_image`.
const ghostUrls = [process.env.GHOST_API_URL, process.env.GHOST_PUBLIC_URL]
  .filter(Boolean)
  .concat('http://localhost:2368');

/** @type {import('next').RemotePattern[]} */
const avatarRemotePatterns = Array.from(
  new Map(
    apiUrls
      .map((raw) => {
        try {
          const url = new URL(raw);
          return {
            protocol: url.protocol.replace(':', ''),
            hostname: url.hostname,
            port: url.port || '',
            pathname: '/personas/**',
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .map((p) => [`${p.protocol}://${p.hostname}:${p.port}${p.pathname}`, p]),
  ).values(),
);

/** @type {import('next').RemotePattern[]} */
const ghostImageRemotePatterns = Array.from(
  new Map(
    ghostUrls
      .map((raw) => {
        try {
          const url = new URL(raw);
          return {
            protocol: url.protocol.replace(':', ''),
            hostname: url.hostname,
            port: url.port || '',
            pathname: '/content/images/**',
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .map((p) => [`${p.protocol}://${p.hostname}:${p.port}${p.pathname}`, p]),
  ).values(),
);

// Ghost's starter posts (e.g. "Coming soon") use feature images hosted on
// Ghost's static CDN, not the local Ghost content volume.
const ghostCdnRemotePatterns = [
  {
    protocol: 'https',
    hostname: 'static.ghost.org',
    port: '',
    pathname: '/**',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_HAS_LANDING_ORIGIN: landingOrigin ? 'true' : 'false',
  },
  images: {
    // AVIF first (smallest), WebP fallback, original PNG as last resort.
    formats: ['image/avif', 'image/webp'],
    // Tighter set tuned for our retina-ish avatar use case (32–256 logical px).
    // The full default set is overkill and inflates the build manifest.
    imageSizes: [16, 32, 48, 64, 96, 128, 192, 256, 384],
    deviceSizes: [320, 480, 640, 750, 828, 1080, 1200, 1920],
    remotePatterns: [
      ...avatarRemotePatterns,
      ...ghostImageRemotePatterns,
      ...ghostCdnRemotePatterns,
    ],
    // Cache optimized variants on the Next server for a day; the upstream
    // `Cache-Control` from the API still controls browser caching.
    minimumCacheTTL: 60 * 60 * 24,
  },
  async rewrites() {
    if (!landingOrigin) return [];

    // Routes served by the Astro landing project that should proxy through
    // the Next.js apex (`careersim.ai`) instead of being handled by Next.
    // Anything not listed here falls through to the Next.js app.
    const landingRoutes = [
      // Marketing pages.
      '/',
      '/privacy',
      '/terms',
      '/security',
    ];

    const landingAssetPrefixes = [
      // Astro bundle output.
      '/_astro/:path*',
      // Static assets under landing/public/...
      '/avatars/:path*',
    ];

    return {
      beforeFiles: [
        ...landingRoutes.map((source) => ({
          source,
          destination: `${landingOrigin}${source === '/' ? '/' : source}`,
        })),
        ...landingAssetPrefixes.map((source) => ({
          source,
          destination: `${landingOrigin}${source}`,
        })),
        {
          source: '/favicon.svg',
          destination: `${landingOrigin}/favicon.svg`,
        },
      ],
    };
  },
};

export default nextConfig;
