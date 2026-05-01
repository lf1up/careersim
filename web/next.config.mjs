const landingOrigin = process.env.LANDING_ORIGIN?.replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
