import React from 'react';

import { RetroBadge } from '@/components/ui/RetroBadge';
import { CONTACT_EMAIL } from '@/lib/seo';

const HIGHLIGHTS = [
  'Custom simulations',
  'Bespoke personas',
  'Support practice',
  'Content pipelines',
  'Assessment',
  'White-label & API',
];

/**
 * Full-width B2B banner appended to the bottom of the public
 * `/simulations` catalogue. Server component; CTA is a plain mailto.
 */
export function B2BBanner() {
  return (
    <section
      aria-labelledby="b2b-banner-heading"
      className="mt-10 mb-2 retro-fade-in"
    >
      <div className="retro-card overflow-hidden">
        {/* Accent strip */}
        <div className="h-2 bg-retro-accent dark:bg-retro-accent-dark border-b-2 border-black dark:border-retro-ink-dark" />

        <div className="p-6 sm:p-8 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <RetroBadge color="yellow">FOR BUSINESS</RetroBadge>
              <RetroBadge color="cyan">CUSTOM BUILDS</RetroBadge>
            </div>
            <h2
              id="b2b-banner-heading"
              className="text-xl sm:text-2xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark leading-relaxed"
            >
              Bring AI personas to your team
            </h2>
            <p className="text-sm text-secondary-600 dark:text-secondary-400">
              The same engine that powers these public simulations — scoped to
              your workflows, your customers, and your brand voice. Pilot in
              weeks, not quarters.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {HIGHLIGHTS.map((h) => (
                <RetroBadge key={h} color="default">
                  {h}
                </RetroBadge>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 shrink-0">
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                'B2B inquiry — custom simulations',
              )}`}
              className="retro-btn-base inline-flex items-center justify-center bg-black dark:bg-retro-ink-dark text-white dark:text-retro-paper-dark hover:opacity-90 px-6 py-3 text-sm font-semibold tracking-wider2 whitespace-nowrap"
            >
              GET IN TOUCH →
            </a>
            <p className="text-[11px] font-monoRetro text-secondary-600 dark:text-secondary-400 text-center">
              Pilot proposal within 2 business days
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
