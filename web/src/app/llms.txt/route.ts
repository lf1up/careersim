import { isBlogEnabled } from '@/lib/blog';
import { crawlableSimulations, publicCrawlPages } from '@/lib/crawl-pages';
import { getPosts } from '@/lib/ghost';
import { listPublicSimulations } from '@/lib/public-api';
import {
  absoluteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  truncateDescription,
} from '@/lib/seo';

export const revalidate = 300;

export async function GET(): Promise<Response> {
  const blogEnabled = isBlogEnabled();
  const pages = publicCrawlPages();
  const [simulations, { posts }] = await Promise.all([
    listPublicSimulations().catch(() => []),
    blogEnabled
      ? getPosts({ page: 1, limit: 50 })
      : Promise.resolve({ posts: [], pagination: null }),
  ]);

  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    '## Core Pages',
    '',
    ...pages.filter(page => page.group === 'core')
      .map(page => `- [${page.title}](${absoluteUrl(page.path)}): ${page.description}`),
    `- [Sitemap](${absoluteUrl('/sitemap.xml')}): XML sitemap for crawlable public pages.`,
  ];

  const publicSimulations = crawlableSimulations(simulations);
  if (publicSimulations.length > 0) {
    lines.push('', '## Public Simulations', '');

    for (const simulation of publicSimulations) {
      const description =
        simulation.description ??
        `Practice the ${simulation.title} career simulation.`;

      lines.push(
        `- [${simulation.title}](${absoluteUrl(`/simulations/${encodeURIComponent(simulation.slug)}`)}): ${truncateDescription(
          description,
        )}`,
      );
    }
  }

  if (blogEnabled && posts.length > 0) {
    lines.push('', '## Blog', '');

    for (const post of posts) {
      if (!post.slug || !post.title) continue;
      const description =
        post.custom_excerpt ||
        post.excerpt ||
        `Read ${post.title} on the ${SITE_NAME} blog.`;
      lines.push(
        `- [${post.title}](${absoluteUrl(`/blog/${encodeURIComponent(post.slug)}`)}): ${truncateDescription(
          description,
        )}`,
      );
    }
  }

  const legalPages = pages.filter(page => page.group === 'legal');
  if (legalPages.length > 0) {
    lines.push('', '## Legal', '', ...legalPages
      .map(page => `- [${page.title}](${absoluteUrl(page.path)}): ${page.description}`));
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
