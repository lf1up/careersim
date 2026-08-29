import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

const siteUrl = process.env.LANDING_SITE_URL?.trim() || 'https://careersim.local';

// Pages stay fully static; only /api/* routes (contact form, altcha
// challenge) render on demand as Vercel serverless functions.
export default defineConfig({
  output: 'static',
  adapter: vercel(),
  site: siteUrl,
  // Dev-only: let Vite serve through throwaway Cloudflare quick tunnels
  // (random subdomain per launch) used for design reviews.
  vite: {
    server: {
      allowedHosts: ['.trycloudflare.com'],
    },
  },
});
