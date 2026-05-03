import { defineConfig } from 'astro/config';

const siteUrl = process.env.LANDING_SITE_URL?.trim() || 'https://careersim.local';

export default defineConfig({
  output: 'static',
  site: siteUrl,
});
