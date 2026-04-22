import React from 'react';
import clsx from 'clsx';

import type { GoalProgress, GoalStatus, SimulationGoal } from '@/lib/types';

interface GoalProgressTrackerProps {
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
 * the richer `description` field.
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
      isOptional: Boolean(p.isOptional),
      status: normalizeStatus(p.status),
    }));
}

const statusStyles: Record<
  GoalStatus,
  { chip: string; icon: string; label: string }
> = {
  not_started: {
    chip:
      'bg-white dark:bg-retro-surface-dark border-black dark:border-retro-ink-dark text-secondary-700 dark:text-secondary-300',
    icon: '○',
    label: 'Not started',
  },
  in_progress: {
    chip:
      'bg-amber-300 dark:bg-amber-500 border-black dark:border-retro-ink-dark text-black',
    icon: '●',
    label: 'In progress',
  },
  achieved: {
    chip:
      'bg-green-300 dark:bg-green-500 border-black dark:border-retro-ink-dark text-black',
    icon: '✓',
    label: 'Achieved',
  },
};

export const GoalProgressTracker: React.FC<GoalProgressTrackerProps> = ({
  progress,
  goals,
}) => {
  const resolved = resolveGoals(progress, goals);

  if (resolved.length === 0) {
    return (
      <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
        This simulation has no tracked goals.
      </p>
    );
  }

  const required = resolved.filter((g) => !g.isOptional);
  const denominator = required.length > 0 ? required.length : resolved.length;
  const achieved = (required.length > 0 ? required : resolved).filter(
    (g) => g.status === 'achieved',
  ).length;
  const pct = denominator === 0 ? 0 : Math.round((achieved / denominator) * 100);

  return (
    // Compact tracker. Row 1 = label + thin progress bar + count. Row 2 =
    // wrapping list of labelled chips so users can still read the goal
    // titles without expanding the card. Chips show icon + #N + title;
    // achieved titles are struck-through; optional goals get a dashed
    // border so the required/optional split stays visible.
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold tracking-wider2 uppercase text-secondary-600 dark:text-secondary-400 shrink-0">
          Goals
        </span>
        <div
          role="progressbar"
          aria-valuenow={achieved}
          aria-valuemin={0}
          aria-valuemax={denominator}
          aria-label={`${achieved} of ${denominator} goals achieved`}
          className="h-2 flex-1 min-w-[6rem] max-w-[12rem] border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark overflow-hidden"
        >
          <div
            className="h-full bg-green-400 dark:bg-green-500 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm font-monoRetro text-retro-ink dark:text-retro-ink-dark shrink-0">
          {achieved}/{denominator}
          {required.length < resolved.length && (
            <span className="text-secondary-600 dark:text-secondary-400">
              {' '}
              · {resolved.length - required.length} opt
            </span>
          )}
        </span>
      </div>

      <ul className="flex flex-wrap items-center gap-1.5">
        {resolved.map((g) => {
          const style = statusStyles[g.status];
          const tooltip = [
            `#${g.number}`,
            g.title,
            style.label,
            g.isOptional ? '(optional)' : null,
            g.description,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={g.number}>
              <span
                title={tooltip}
                className={clsx(
                  // Match `RetroBadge`: px-2.5 py-0.5 · text-xs · border-2
                  // so the goal chips sit at the same visual weight as the
                  // persona/difficulty pills in the title row.
                  'inline-flex items-center gap-1.5 px-2.5 py-0.5 border-2 text-xs font-semibold select-none',
                  style.chip,
                  g.isOptional && 'border-dashed',
                )}
              >
                <span aria-label={style.label} className="leading-none">
                  {style.icon}
                </span>
                <span className="font-monoRetro text-secondary-700 dark:text-secondary-800">
                  #{g.number}
                </span>
                <span
                  className={clsx(
                    g.status === 'achieved' && 'line-through opacity-80',
                  )}
                >
                  {g.title}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default GoalProgressTracker;
