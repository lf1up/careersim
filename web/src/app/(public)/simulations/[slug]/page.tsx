import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  getPublicSimulation,
  listPublicSimulations,
} from '@/lib/public-api';
import { absoluteUrl, metadataFor, truncateDescription } from '@/lib/seo';

import { SimulationDetailClient } from './SimulationDetailClient';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const simulations = await listPublicSimulations().catch(() => []);
  return simulations.map((simulation) => ({ slug: simulation.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
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
  const { slug } = await params;
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
              name: 'careersim.ai',
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
