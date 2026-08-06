/**
 * Web Analytics endpoints for marketing pages.
 *
 * Production HTML is reverse-proxied through the apex `web` app on
 * careersim.ai. Landing's build injects a project-specific path
 * (`/<hash>/script.js`) that only exists on the Astro Vercel project —
 * and that project's `*.vercel.app` URLs are SSO-protected, so absolute
 * `VERCEL_URL` links fail in the browser.
 *
 * Use the classic relative `/_vercel/insights/*` endpoints instead so
 * requests stay on the apex host and land on the **web** project's Web
 * Analytics (enable it there if it isn't already).
 */
export function landingAnalyticsProps(): {
  scriptSrc: string;
  eventEndpoint: string;
  viewEndpoint: string;
} {
  return {
    scriptSrc: '/_vercel/insights/script.js',
    eventEndpoint: '/_vercel/insights/event',
    viewEndpoint: '/_vercel/insights/view',
  };
}
