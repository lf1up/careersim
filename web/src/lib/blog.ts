import { isGhostConfigured } from './ghost';

/**
 * Blog feature flag — opt-in kill switch for the headless Ghost surface.
 *
 * Requires `NEXT_PUBLIC_BLOG_ENABLED=true`/`1` **and** Ghost Content API
 * env (`GHOST_API_URL` + `GHOST_CONTENT_API_KEY`). Unset flag, missing
 * Ghost credentials, `false`, or `0` keeps it off: `/blog` routes 404,
 * and blog URLs are omitted from sitemap / robots / llms.txt.
 */
export function isBlogEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_BLOG_ENABLED;
  if (v !== 'true' && v !== '1') return false;
  return isGhostConfigured();
}
