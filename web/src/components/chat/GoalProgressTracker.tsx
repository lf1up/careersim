'use client';

import React, { useState } from 'react';
import clsx from 'clsx';

import type { GoalProgress, GoalStatus, SimulationGoal } from '@/lib/types';

interface GoalProgressBaseProps {
  /** Dynamic per-goal status from the session (camelCase from the agent). */
  progress: GoalProgress[];
  /**
   * Optional static list from `simulation.conversation_goals`. When provided
   * we use it as the authoritative order and fall back to descriptions that
   * aren't surfaced on the session payload.
   */
  goals?: SimulationGoal[];
}

interface ResolvedGoal {
  number: number;
  title: string;
  description?: string;
  keyBehaviors: string[];
  successIndicators: string[];
  isOptional: boolean;
  status: GoalStatus;
}

function normalizeStatus(value: unknown): GoalStatus {
  if (value === 'achieved' || value === 'in_progress' || value === 'not_started') {
    return value;
  }
  return 'not_started';
}

/**
 * Merge the agent's dynamic `progress` with the simulation's static `goals`.
 * The agent seeds `goal_progress` at init time with title + number, so the
 * tracker can work even when only `progress` is available — but if the
 * catalogue entry loads later we prefer it for the canonical ordering and
 * the richer `description` / `key_behaviors` / `success_indicators` fields.
 */
function resolveGoals(
  progress: GoalProgress[],
  goals: SimulationGoal[] | undefined,
): ResolvedGoal[] {
  const progressByNumber = new Map<number, GoalProgress>();
  for (const p of progress) {
    if (typeof p?.goalNumber === 'number') {
      progressByNumber.set(p.goalNumber, p);
    }
  }

  if (goals && goals.length > 0) {
    return goals
      .slice()
      .sort((a, b) => a.goal_number - b.goal_number)
      .map((g) => {
        const p = progressByNumber.get(g.goal_number);
        return {
          number: g.goal_number,
          title: g.title,
          description: g.description,
          keyBehaviors: g.key_behaviors ?? [],
          successIndicators: g.success_indicators ?? [],
          isOptional: g.is_optional,
          status: normalizeStatus(p?.status),
        };
      });
  }

  // Fall back to whatever the session already has. Sort by goalNumber for
  // deterministic ordering even if the backend shuffles entries.
  return progress
    .slice()
    .sort((a, b) => (a.goalNumber ?? 0) - (b.goalNumber ?? 0))
    .map((p) => ({
      number: p.goalNumber,
      title: typeof p.title === 'string' && p.title.length > 0 ? p.title : `Goal ${p.goalNumber}`,
      keyBehaviors: [],
      successIndicators: [],
      isOptional: Boolean(p.isOptional),
      status: normalizeStatus(p.status),
    }));
}

// Aggregated counts we surface above/around the chip list. `denominator`
// prefers required goals so the ratio matches "have I done what matters?";
// if there are no required goals we fall back to all goals so we don't
// render a meaningless `0/0`.
function computeStats(resolved: ResolvedGoal[]) {
  const required = resolved.filter((g) => !g.isOptional);
  const denominator = required.length > 0 ? required.length : resolved.length;
  const achieved = (required.length > 0 ? required : resolved).filter(
    (g) => g.status === 'achieved',
  ).length;
  const pct = denominator === 0 ? 0 : Math.round((achieved / denominator) * 100);
  const optionalCount = resolved.length - required.length;
  return { required, denominator, achieved, pct, optionalCount };
}

const statusStyles: Record<
  GoalStatus,
  { chip: string; icon: string; label: string; badge: string }
> = {
  not_started: {
    chip:
      'bg-white dark:bg-retro-surface-dark border-black dark:border-retro-ink-dark text-secondary-700 dark:text-secondary-300',
    icon: '○',
    label: 'Not started',
    badge:
      'bg-white dark:bg-retro-surface-dark text-secondary-700 dark:text-secondary-300',
  },
  in_progress: {
    chip:
      'bg-amber-300 dark:bg-amber-500 border-black dark:border-retro-ink-dark text-black',
    icon: '●',
    label: 'In progress',
    badge: 'bg-amber-300 dark:bg-amber-500 text-black',
  },
  achieved: {
    chip:
      'bg-green-300 dark:bg-green-500 border-black dark:border-retro-ink-dark text-black',
    icon: '✓',
    label: 'Achieved',
    badge: 'bg-green-300 dark:bg-green-500 text-black',
  },
};

// Tooltip-ish popover that explains what the user actually has to do for a
// given goal. Positioned *below* the chip with `top-full` so it doesn't get
// clipped by the RetroCard header above the goal row. Centered horizontally
// via a 50% translate. `pointer-events-none` keeps the chip's hover state
// stable if the cursor passes over the popover body — since there's
// nothing interactive inside, we don't lose anything by making it
// non-interactive.
interface GoalHoverCardProps {
  id: string;
  goal: ResolvedGoal;
}

const GoalHoverCard: React.FC<GoalHoverCardProps> = ({ id, goal }) => {
  const style = statusStyles[goal.status];
  return (
    <div
      id={id}
      role="tooltip"
      className={clsx(
        'pointer-events-none absolute z-30 top-full left-1/2 -translate-x-1/2 mt-2',
        'w-72 sm:w-80 max-w-[min(22rem,calc(100vw-2rem))]',
        'retro-card p-3 text-left shadow-retro-4 dark:shadow-retro-dark-4',
        'text-retro-ink dark:text-retro-ink-dark',
      )}
    >
      <div className="flex items-start gap-2 mb-2">
        <span className="font-monoRetro text-[11px] text-secondary-600 dark:text-secondary-400 shrink-0 mt-0.5">
          #{goal.number}
        </span>
        <h4 className="text-sm font-semibold leading-snug flex-1">
          {goal.title}
        </h4>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-0.5 border-2 border-black dark:border-retro-ink-dark text-[10px] font-semibold uppercase tracking-wider2',
            style.badge,
          )}
        >
          <span aria-hidden>{style.icon}</span>
          {style.label}
        </span>
        {goal.isOptional && (
          <span className="inline-flex items-center px-2 py-0.5 border-2 border-dashed border-black dark:border-retro-ink-dark text-[10px] font-semibold uppercase tracking-wider2 text-secondary-700 dark:text-secondary-300">
            Optional
          </span>
        )}
      </div>

      {goal.description && (
        <p className="text-xs leading-relaxed mb-2 text-retro-ink dark:text-retro-ink-dark">
          {goal.description}
        </p>
      )}

      {goal.keyBehaviors.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] font-semibold tracking-wider2 uppercase text-secondary-600 dark:text-secondary-400 mb-1">
            Key behaviors
          </p>
          <ul className="list-disc pl-4 space-y-0.5 text-xs text-retro-ink dark:text-retro-ink-dark">
            {goal.keyBehaviors.map((item, idx) => (
              <li key={`kb-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {goal.successIndicators.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold tracking-wider2 uppercase text-secondary-600 dark:text-secondary-400 mb-1">
            Success indicators
          </p>
          <ul className="list-disc pl-4 space-y-0.5 text-xs text-retro-ink dark:text-retro-ink-dark">
            {goal.successIndicators.map((item, idx) => (
              <li key={`si-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {!goal.description &&
        goal.keyBehaviors.length === 0 &&
        goal.successIndicators.length === 0 && (
          <p className="text-xs italic text-secondary-600 dark:text-secondary-400">
            No additional guidance provided for this goal.
          </p>
        )}
    </div>
  );
};

/**
 * One-liner showing `GOALS [====    ] 2/5` – the top row of the old
 * tracker. Exposed as its own component so it can be dropped into a
 * RetroCard header's `actions` slot and right-aligned next to the title,
 * while the larger chip list lives in the card body.
 */
interface GoalProgressSummaryProps extends GoalProgressBaseProps {
  className?: string;
}

export const GoalProgressSummary: React.FC<GoalProgressSummaryProps> = ({
  progress,
  goals,
  className,
}) => {
  const resolved = resolveGoals(progress, goals);
  if (resolved.length === 0) return null;
  const { denominator, achieved, pct, optionalCount } = computeStats(resolved);

  return (
    // Always stack the label above the bar+count so the summary reads as
    // a stable two-row control and never competes with the persona /
    // difficulty pills for horizontal room in the card header.
    <div className={clsx('flex flex-col items-end gap-1', className)}>
      <span className="text-sm font-semibold tracking-wider2 uppercase text-secondary-600 dark:text-secondary-400 shrink-0">
        Goals achieved
      </span>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-valuenow={achieved}
          aria-valuemin={0}
          aria-valuemax={denominator}
          aria-label={`${achieved} of ${denominator} goals achieved`}
          className="h-2 w-24 sm:w-32 border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark overflow-hidden shrink-0"
        >
          <div
            className="h-full bg-green-400 dark:bg-green-500 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm font-monoRetro text-retro-ink dark:text-retro-ink-dark shrink-0">
          {achieved}/{denominator}
          {optionalCount > 0 && (
            <span className="text-secondary-600 dark:text-secondary-400">
              {' '}
              · {optionalCount} opt
            </span>
          )}
        </span>
      </div>
    </div>
  );
};

/**
 * Wrapping row of labelled goal chips. Hover / focus a chip to reveal the
 * full description + key behaviors + success indicators popover.
 */
interface GoalProgressChipsProps extends GoalProgressBaseProps {
  className?: string;
  /** Copy shown when there are no tracked goals for the session. */
  emptyMessage?: string;
}

export const GoalProgressChips: React.FC<GoalProgressChipsProps> = ({
  progress,
  goals,
  className,
  emptyMessage = 'This simulation has no tracked goals.',
}) => {
  const resolved = resolveGoals(progress, goals);
  // Track which chip's popover is open. We use a single state slot rather
  // than one per chip because at most one popover can be visible at a time.
  const [openGoal, setOpenGoal] = useState<number | null>(null);

  if (resolved.length === 0) {
    return (
      <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className={clsx('flex flex-wrap items-center gap-1.5', className)}>
      {resolved.map((g) => {
        const style = statusStyles[g.status];
        const isOpen = openGoal === g.number;
        const popoverId = `goal-popover-${g.number}`;
        // Only close when the leaving chip matches the open one. Avoids a
        // stale close if the user quickly hops between chips (mouseleave
        // from chip A can fire after mouseenter on chip B).
        const close = () =>
          setOpenGoal((cur) => (cur === g.number ? null : cur));
        return (
          <li key={g.number} className="relative">
            <button
              type="button"
              aria-describedby={isOpen ? popoverId : undefined}
              aria-expanded={isOpen}
              onMouseEnter={() => setOpenGoal(g.number)}
              onMouseLeave={close}
              onFocus={() => setOpenGoal(g.number)}
              onBlur={close}
              className={clsx(
                // Match `RetroBadge`: px-2.5 py-0.5 · text-xs · border-2
                // so the goal chips sit at the same visual weight as the
                // persona/difficulty pills in the title row.
                'inline-flex items-center gap-1.5 px-2.5 py-0.5 border-2 text-xs font-semibold select-none cursor-default',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1',
                style.chip,
                g.isOptional && 'border-dashed',
              )}
            >
              <span aria-label={style.label} className="leading-none">
                {style.icon}
              </span>
              <span className="font-monoRetro opacity-70">
                #{g.number}
              </span>
              <span
                className={clsx(
                  g.status === 'achieved' && 'line-through opacity-80',
                )}
              >
                {g.title}
              </span>
            </button>
            {isOpen && <GoalHoverCard id={popoverId} goal={g} />}
          </li>
        );
      })}
    </ul>
  );
};

/**
 * Convenience wrapper that stacks `GoalProgressSummary` over
 * `GoalProgressChips` — kept for callers that want the combined block in
 * one place instead of splitting the header row off into a card action.
 */
export const GoalProgressTracker: React.FC<GoalProgressBaseProps> = ({
  progress,
  goals,
}) => {
  return (
    <div className="space-y-2">
      <GoalProgressSummary progress={progress} goals={goals} />
      <GoalProgressChips progress={progress} goals={goals} />
    </div>
  );
};

export default GoalProgressTracker;
