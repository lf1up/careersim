import type { MetadataRoute } from 'next';

import { pluginRobotsDisallow } from '@/extensions';
import { isBlogEnabled } from '@/lib/blog';
import { isPricingEnabled } from '@/lib/pricing';
import { PRIVATE_CRAWL_PATHS, publicCrawlPages } from '@/lib/crawl-pages';
import { SITE_URL } from '@/lib/seo';

export const revalidate = 300;

export default function robots(): MetadataRoute.Robots {
  // Keep public assets crawlable; more specific private/disabled paths win.
  const allow = [...new Set(['/', '/llms.txt', ...publicCrawlPages().map(page => page.path)])];

  return {
    rules: [
      {
        userAgent: '*',
        allow,
        disallow: [...new Set([
          ...PRIVATE_CRAWL_PATHS,
          ...(isBlogEnabled() ? [] : ['/blog']),
          ...(isPricingEnabled() ? [] : ['/pricing']),
          ...pluginRobotsDisallow(),
        ])],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
