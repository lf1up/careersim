/**
 * Blog feature flag — opt-in kill switch for the headless Ghost surface.
 *
 * Only `true` / `1` enables the blog. Unset, `false`, or `0` keeps it off:
 * `/blog` routes 404, and blog URLs are omitted from sitemap / robots /
 * llms.txt. Set `NEXT_PUBLIC_BLOG_ENABLED=true` after Ghost is configured.
 */
export function isBlogEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_BLOG_ENABLED;
  return v === 'true' || v === '1';
}
