import React from 'react';
import clsx from 'clsx';

/**
 * Shared visual language for 0-100 skill scores (session debrief report +
 * aggregate analytics). Pure CSS bar gauges — no chart library — with
 * plain-language band labels inspired by psychometric report design.
 */

const SKILL_LABELS: Record<string, string> = {
  clarity: 'Clarity',
  confidence: 'Confidence',
  problem_solving: 'Problem solving',
  emotional_intelligence: 'Emotional intelligence',
  goal_outcome: 'Goal outcome',
};

export function skillLabel(key: string): string {
  return (
    SKILL_LABELS[key] ??
    key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  );
}

export interface ScoreBand {
  label: string;
  /** Bar fill classes (light + dark). */
  bar: string;
  /** RetroBadge-compatible text/background classes for inline chips. */
  chip: string;
}

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) {
    return {
      label: 'Strong',
      bar: 'bg-green-400 dark:bg-green-500',
      chip: 'bg-green-300 dark:bg-green-500 text-black',
    };
  }
  if (score >= 60) {
    return {
      label: 'Solid',
      bar: 'bg-lime-300 dark:bg-lime-500',
      chip: 'bg-lime-300 dark:bg-lime-500 text-black',
    };
  }
  if (score >= 40) {
    return {
      label: 'Developing',
      bar: 'bg-amber-300 dark:bg-amber-500',
      chip: 'bg-amber-300 dark:bg-amber-500 text-black',
    };
  }
  return {
    label: 'Needs work',
    bar: 'bg-red-400 dark:bg-red-500',
    chip: 'bg-red-300 dark:bg-red-500 text-black',
  };
}

export interface SkillGaugeProps {
  label: string;
  /** 0-100 */
  score: number;
  /** Optional one-liner shown under the bar (the LLM rationale). */
  rationale?: string;
  /** Tighter spacing for dashboard/analytics strips. */
  compact?: boolean;
  className?: string;
}

export const SkillGauge: React.FC<SkillGaugeProps> = ({
  label,
  score,
  rationale,
  compact = false,
  className,
}) => {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = scoreBand(clamped);
  return (
    <div className={clsx(compact ? 'space-y-1' : 'space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={clsx(
            'font-semibold text-retro-ink dark:text-retro-ink-dark',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          {label}
        </span>
        <span className="flex items-baseline gap-2 shrink-0">
          <span
            className={clsx(
              'px-1.5 py-0.5 border-2 border-black dark:border-retro-ink-dark text-[10px] font-semibold uppercase tracking-wider2',
              band.chip,
            )}
          >
            {band.label}
          </span>
          <span
            className={clsx(
              'font-monoRetro text-retro-ink dark:text-retro-ink-dark',
              compact ? 'text-xs' : 'text-sm',
            )}
          >
            {clamped}
          </span>
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-label={`${label}: ${clamped} out of 100 (${band.label})`}
        className={clsx(
          'w-full border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark overflow-hidden',
          compact ? 'h-3' : 'h-4',
        )}
      >
        <div
          className={clsx('h-full transition-[width] duration-500', band.bar)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {rationale && (
        <p className="text-xs text-secondary-600 dark:text-secondary-400">
          {rationale}
        </p>
      )}
    </div>
  );
};

export default SkillGauge;
