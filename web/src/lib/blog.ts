/**
 * Blog feature flag — kill switch for the headless Ghost surface.
 *
 * When `NEXT_PUBLIC_BLOG_ENABLED` is `false` or `0`, the Blog nav link is
 * hidden, `/blog` routes 404, and blog URLs are omitted from sitemap /
 * robots / llms.txt. Unset or any other value keeps the blog on (opt-out).
 *
 * Mirrors the spirit of `isVoiceEnabledClientSide`, but defaults **on** so
 * existing local setups keep working without an extra env line.
 */
export function isBlogEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_BLOG_ENABLED;
  return v !== 'false' && v !== '0';
}
