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
    remotePatterns: avatarRemotePatterns,
    // Cache optimized variants on the Next server for a day; the upstream
    // `Cache-Control` from the API still controls browser caching.
    minimumCacheTTL: 60 * 60 * 24,
  },
  async rewrites() {
    if (!landingOrigin) return [];

    return {
      beforeFiles: [
        {
          source: '/',
          destination: `${landingOrigin}/`,
        },
        {
          source: '/_astro/:path*',
          destination: `${landingOrigin}/_astro/:path*`,
        },
        {
          source: '/favicon.svg',
          destination: `${landingOrigin}/favicon.svg`,
        },
      ],
    };
  },
};

export default nextConfig;
