import type { MetadataRoute } from 'next';

import { listPublicSimulations } from '@/lib/public-api';
import { absoluteUrl } from '@/lib/seo';

// Date the legal pages were last revised. Keep in sync with the
// `lastUpdated` prop on `landing/src/pages/{privacy,terms,security}.astro`.
const LEGAL_LAST_UPDATED = new Date('2026-05-17T00:00:00Z');

const LEGAL_ROUTES = ['/privacy', '/terms', '/security'] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const simulations = await listPublicSimulations().catch(() => []);
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
    ...simulations.map((simulation) => ({
      url: absoluteUrl(`/simulations/${simulation.slug}`),
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...LEGAL_ROUTES.map((path) => ({
      url: absoluteUrl(path),
      lastModified: LEGAL_LAST_UPDATED,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ];
}
