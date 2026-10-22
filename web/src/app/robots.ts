import type { MetadataRoute } from 'next';

import { pluginRobotsDisallow } from '@/extensions';
import { isBlogEnabled } from '@/lib/blog';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  const allow = [
    '/',
    '/llms.txt',
    '/simulations',
    '/simulations/',
    '/business',
    '/privacy',
    '/terms',
    '/security',
  ];

  if (isBlogEnabled()) {
    allow.push('/blog', '/blog/');
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow,
        disallow: [
          '/dashboard',
          '/profile',
          '/sessions',
          '/forgot-password',
          '/reset-password',
          '/auth/',
          ...(isBlogEnabled() ? [] : ['/blog', '/blog/']),
          ...pluginRobotsDisallow(),
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
