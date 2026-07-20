import { isBlogEnabled } from '@/lib/blog';
import { getPosts } from '@/lib/ghost';
import { listPublicSimulations } from '@/lib/public-api';
import {
  absoluteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  truncateDescription,
} from '@/lib/seo';

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const blogEnabled = isBlogEnabled();
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
    `- [Simulation catalog](${absoluteUrl('/simulations')}): Browse AI career simulations for interviews, workplace communication, feedback, and professional growth.`,
    ...(blogEnabled
      ? [
          `- [Blog](${absoluteUrl('/blog')}): Guides and practice tips for career-defining conversations.`,
        ]
      : []),
    `- [Sitemap](${absoluteUrl('/sitemap.xml')}): XML sitemap for crawlable public pages.`,
  ];

  if (simulations.length > 0) {
    lines.push('', '## Public Simulations', '');

    for (const simulation of simulations) {
      const description =
        simulation.description ??
        `Practice the ${simulation.title} career simulation.`;

      lines.push(
        `- [${simulation.title}](${absoluteUrl(`/simulations/${simulation.slug}`)}): ${truncateDescription(
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
        `- [${post.title}](${absoluteUrl(`/blog/${post.slug}`)}): ${truncateDescription(
          description,
        )}`,
      );
    }
  }

  lines.push(
    '',
    '## Legal',
    '',
    `- [Privacy policy](${absoluteUrl('/privacy')}): How ${SITE_NAME} collects, uses, and protects the data shared during practice sessions.`,
    `- [Terms of service](${absoluteUrl('/terms')}): Rules for using ${SITE_NAME}, including acceptable use, AI-generated output, and the limits of an AI practice tool.`,
    `- [Security](${absoluteUrl('/security')}): How accounts, transcripts, and infrastructure are protected, plus how to report a vulnerability.`,
  );

  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
