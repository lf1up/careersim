import type { MetadataRoute } from 'next';

import { isBlogEnabled } from '@/lib/blog';
import { getAllPosts } from '@/lib/ghost';
import { listPublicSimulations } from '@/lib/public-api';
import { absoluteUrl } from '@/lib/seo';

// Date the legal pages were last revised. Keep in sync with the
// `lastUpdated` prop on `landing/src/pages/{privacy,terms,security}.astro`.
const LEGAL_LAST_UPDATED = new Date('2026-05-17T00:00:00Z');

const LEGAL_ROUTES = ['/privacy', '/terms', '/security'] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const blogEnabled = isBlogEnabled();
  const [simulations, posts] = await Promise.all([
    listPublicSimulations().catch(() => []),
    blogEnabled ? getAllPosts() : Promise.resolve([]),
  ]);
  const now = new Date();

  return [
    {
      url: absoluteUrl('/'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: absoluteUrl('/simulations'),
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...(blogEnabled
      ? [
          {
            url: absoluteUrl('/blog'),
            lastModified: now,
            changeFrequency: 'daily' as const,
            priority: 0.8,
          },
        ]
      : []),
    ...simulations.map((simulation) => ({
      url: absoluteUrl(`/simulations/${simulation.slug}`),
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...(blogEnabled
      ? posts
          .filter((post) => post.slug)
          .map((post) => ({
            url: absoluteUrl(`/blog/${post.slug}`),
            lastModified: post.updated_at
              ? new Date(post.updated_at)
              : post.published_at
                ? new Date(post.published_at)
                : now,
            changeFrequency: 'weekly' as const,
            priority: 0.6,
          }))
      : []),
    ...LEGAL_ROUTES.map((path) => ({
      url: absoluteUrl(path),
      lastModified: LEGAL_LAST_UPDATED,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ];
}
