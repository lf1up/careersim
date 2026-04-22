// Helpers for rendering simulation metadata in list views (dashboard,
// sessions, simulations). Centralised here so the difficulty scale and
// the "lookup simulation by slug" shape stay consistent across pages.

import type { RetroBadgeProps } from '@/components/ui/RetroBadge';
import type { Simulation } from '@/lib/types';

export function difficultyColor(
  level: number | null | undefined,
): RetroBadgeProps['color'] {
  if (level == null) return 'default';
  if (level <= 1) return 'lime';
  if (level === 2) return 'green';
  if (level === 3) return 'amber';
  if (level === 4) return 'orange';
  return 'red';
}

export function difficultyLabel(level: number | null | undefined): string {
  if (level == null) return '—';
  const labels: Record<number, string> = {
    1: 'Beginner',
    2: 'Easy',
    3: 'Moderate',
    4: 'Challenging',
    5: 'Expert',
  };
  return labels[level] ?? `Level ${level}`;
}

/** Build a `{slug → Simulation}` lookup map for session-list enrichment. */
export function indexSimulations(
  simulations: Simulation[],
): Record<string, Simulation> {
  const out: Record<string, Simulation> = {};
  for (const s of simulations) out[s.slug] = s;
  return out;
}
