import { listPublicSimulations } from '@/lib/public-api';
import {
  absoluteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  truncateDescription,
} from '@/lib/seo';

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const simulations = await listPublicSimulations().catch(() => []);

  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    '## Core Pages',
    '',
    `- [Simulation catalog](${absoluteUrl('/simulations')}): Browse AI career simulations for interviews, workplace communication, feedback, and professional growth.`,
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

  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
