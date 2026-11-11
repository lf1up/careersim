import type { MetadataRoute } from 'next';

import { isBlogEnabled } from '@/lib/blog';
import { crawlableSimulations, publicCrawlPages } from '@/lib/crawl-pages';
import { getAllPosts, type GhostPost } from '@/lib/ghost';
import { listPublicSimulations } from '@/lib/public-api';
import { absoluteUrl } from '@/lib/seo';

export const revalidate = 300;

function postLastModified(post: GhostPost): Date | undefined {
  for (const value of [post.updated_at, post.published_at]) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [simulations, posts] = await Promise.all([
    listPublicSimulations().catch(() => []),
    isBlogEnabled() ? getAllPosts() : Promise.resolve([]),
  ]);

  const entries: MetadataRoute.Sitemap = [
    ...publicCrawlPages().map(({ path, changeFrequency, priority }) => ({
      url: absoluteUrl(path), changeFrequency, priority,
    })),
    ...crawlableSimulations(simulations).map(simulation => ({
      url: absoluteUrl(`/simulations/${encodeURIComponent(simulation.slug)}`),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...posts.flatMap(post => post.slug ? [{
      url: absoluteUrl(`/blog/${encodeURIComponent(post.slug)}`),
      lastModified: postLastModified(post),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }] : []),
  ];
  return [...new Map(entries.map(entry => [entry.url, entry])).values()];
}
