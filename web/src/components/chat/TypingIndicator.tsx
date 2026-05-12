import React from 'react';

import { PersonaAvatar } from '@/components/ui/PersonaAvatar';

// Type-only import keeps the runtime ESM graph acyclic (ChatTranscript
// imports this file at runtime).
import type { ChatPersona } from './ChatTranscript';

interface TypingIndicatorProps {
  persona?: ChatPersona;
  /**
   * Render the persona "Name · Title" label above the bubble. Used at the
   * start of a fresh AI streak (after a human reply); suppressed during
   * the typing pause *between* burst follow-ups so the label doesn't
   * repeat back-to-back with the prior AI bubble.
   */
  showLabel?: boolean;
}

/**
 * Three-dot typing indicator in an AI-style retro bubble. Pure CSS, uses
 * Tailwind's `animate-bounce` with staggered `animation-delay` for the wave.
 *
 * When a persona is provided we render the same avatar gutter the AI bubbles
 * use, so the indicator visually "comes from" the persona.
 */
export const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  persona,
  showLabel,
}) => {
  return (
    <div
      className="flex items-start gap-2 justify-start"
      aria-live="polite"
      aria-label="Assistant is typing"
    >
      {persona ? (
        <PersonaAvatar
          name={persona.name}
          avatarUrl={persona.avatarUrl}
          slug={persona.slug}
          roleHint={persona.role}
          size={36}
          previewOnHover
        />
      ) : (
        <span className="h-9 w-9 shrink-0" aria-hidden />
      )}
      <div className="min-w-0">
        {persona && showLabel && (
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-tight">
            <span className="font-semibold text-retro-ink dark:text-retro-ink-dark">
              {persona.name}
            </span>
            {persona.role && (
              <span className="text-secondary-600 dark:text-secondary-400">
                {persona.role}
              </span>
            )}
          </div>
        )}
        <div className="px-4 py-3 border-2 shadow-retro-2 dark:shadow-retro-dark-2 bg-white dark:bg-retro-surface-dark border-black dark:border-retro-ink-dark">
          <span className="flex items-center gap-1.5">
            <Dot delay="0ms" />
            <Dot delay="150ms" />
            <Dot delay="300ms" />
          </span>
        </div>
      </div>
    </div>
  );
};

const Dot: React.FC<{ delay: string }> = ({ delay }) => (
  <span
    className="inline-block w-2 h-2 bg-retro-ink dark:bg-retro-ink-dark rounded-full animate-bounce"
    style={{ animationDelay: delay }}
  />
);
