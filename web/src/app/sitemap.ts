import type { MetadataRoute } from 'next';

import { listPublicSimulations } from '@/lib/public-api';
import { absoluteUrl } from '@/lib/seo';

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
  ];
}
