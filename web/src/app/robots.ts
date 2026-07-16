import type { MetadataRoute } from 'next';

import { isBlogEnabled } from '@/lib/blog';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  const allow = [
    '/',
    '/llms.txt',
    '/simulations',
    '/simulations/',
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
          '/login',
          '/register',
          '/forgot-password',
          '/reset-password',
          '/auth/',
          ...(isBlogEnabled() ? [] : ['/blog', '/blog/']),
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
