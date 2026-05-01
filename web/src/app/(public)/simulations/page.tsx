import type { Metadata } from 'next';

import { listPublicSimulations } from '@/lib/public-api';
import { absoluteUrl, metadataFor, SITE_NAME } from '@/lib/seo';

import { SimulationsClient } from './SimulationsClient';

export const metadata: Metadata = metadataFor({
  title: 'AI career simulations',
  description:
    'Browse AI career simulations for interview preparation, workplace communication, conflict resolution, and professional coaching practice.',
  path: '/simulations',
  keywords: [
    'AI career simulations',
    'interview role play',
    'workplace communication practice',
    'career coaching simulator',
  ],
});

export default async function SimulationsPage() {
  const simulations = await listPublicSimulations().catch(() => []);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: `${SITE_NAME} AI career simulations`,
            itemListElement: simulations.map((simulation, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              url: absoluteUrl(`/simulations/${simulation.slug}`),
              name: simulation.title,
              description: simulation.description,
            })),
          }),
        }}
      />
      <SimulationsClient initialSimulations={simulations} />
    </>
  );
}
