import React from 'react';

/**
 * Three-dot typing indicator in an AI-style retro bubble. Pure CSS, uses
 * Tailwind's `animate-bounce` with staggered `animation-delay` for the wave.
 */
export const TypingIndicator: React.FC = () => {
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="Assistant is typing">
      <div className="px-4 py-3 border-2 shadow-retro-2 dark:shadow-retro-dark-2 bg-white dark:bg-retro-surface-dark border-black dark:border-retro-ink-dark">
        <span className="flex items-center gap-1.5">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
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
