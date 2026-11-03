import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  getPublicSimulation,
  listPublicSimulations,
} from '@/lib/public-api';
import {
  absoluteUrl,
  metadataFor,
  SITE_NAME,
  truncateDescription,
} from '@/lib/seo';

import { PrivateSimulationDetailClient, SimulationDetailClient } from './SimulationDetailClient';

interface PageProps {
  params: Promise<{ slug: string }>;
}

function decodeSlug(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function generateStaticParams() {
  const simulations = await listPublicSimulations().catch(() => []);
  return simulations.map((simulation) => ({ slug: simulation.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug: routeParam } = await params;
  const slug = decodeSlug(routeParam);
  if (slug.includes(':')) {
    return metadataFor({
      title: 'Simulation details',
      description: 'Details for a private simulation you have access to.',
      path: `/simulations/${encodeURIComponent(slug)}`,
      robots: { index: false, follow: false },
    });
  }
  const simulation = await getPublicSimulation(slug).catch(() => null);

  if (!simulation) {
    return metadataFor({
      title: 'Simulation not found',
      description: 'This career simulation could not be found.',
      path: `/simulations/${slug}`,
      robots: { index: false, follow: false },
    });
  }

  const description = truncateDescription(
    simulation.description || simulation.scenario,
  );

  return metadataFor({
    title: `${simulation.title} simulation`,
    description,
    path: `/simulations/${simulation.slug}`,
    keywords: [
      simulation.title,
      simulation.persona_name,
      simulation.persona_role ?? '',
      ...simulation.skills_to_learn,
      ...simulation.tags,
    ].filter(Boolean),
  });
}

export default async function SimulationDetailPage({ params }: PageProps) {
  const { slug: routeParam } = await params;
  const slug = decodeSlug(routeParam);
  if (slug.includes(':')) return <PrivateSimulationDetailClient slug={slug} />;
  const simulation = await getPublicSimulation(slug).catch(() => null);

  if (!simulation) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Course',
            name: simulation.title,
            description: simulation.description,
            url: absoluteUrl(`/simulations/${simulation.slug}`),
            provider: {
              '@type': 'Organization',
              name: SITE_NAME,
              url: absoluteUrl('/'),
            },
            teaches: simulation.skills_to_learn,
          }),
        }}
      />
      <SimulationDetailClient simulation={simulation} />
    </>
  );
}
