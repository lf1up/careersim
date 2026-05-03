'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { SessionSummary, Simulation } from '@/lib/types';
import {
  difficultyColor,
  difficultyLabel,
  indexSimulations,
} from '@/lib/simulation-meta';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroBadge } from '@/components/ui/RetroBadge';
import { Button } from '@/components/ui/Button';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Sessions only carry `simulation_slug`; fetch the catalogue in
        // parallel so we can surface the title, difficulty, goal count,
        // and persona name inline on each row.
        const [rows, sims] = await Promise.all([
          apiClient.listSessions(),
          apiClient.listSimulations(),
        ]);
        if (!cancelled) {
          setSessions(rows);
          setSimulations(sims);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load sessions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const simulationBySlug = useMemo(
    () => indexSimulations(simulations),
    [simulations],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  return (
    <div className="space-y-6 pb-3 pr-[10px] sm:pb-4 sm:pr-0 retro-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
            MY SESSIONS
          </h1>
          <p className="text-sm text-secondary-600 dark:text-secondary-400 mt-1">
            Every conversation you&apos;ve started with a persona.
          </p>
        </div>
        <Link href="/simulations">
          <Button variant="primary">Start new session</Button>
        </Link>
      </div>

      {sorted.length === 0 ? (
        <RetroCard>
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            No sessions yet.{' '}
            <Link href="/simulations" className="underline text-primary-600 dark:text-primary-400">
              Browse simulations
            </Link>{' '}
            to start one.
          </p>
        </RetroCard>
      ) : (
        <div className="space-y-3 retro-stagger">
          {sorted.map((s) => {
            const sim = simulationBySlug[s.simulation_slug];
            const title = sim?.title ?? s.simulation_slug;
            return (
              <Link
                key={s.id}
                href={`/sessions/${s.id}`}
                className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2"
              >
                <RetroCard className="retro-card-interactive">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="font-semibold text-retro-ink dark:text-retro-ink-dark break-words">
                        {title}
                      </p>
                      {/* Meta pills: hidden if the simulation couldn't be
                          resolved from the catalogue (e.g. it was deleted). */}
                      {sim && (
                        <div className="flex flex-wrap items-center gap-2">
                          {sim.persona_name && (
                            <RetroBadge color="cyan">{sim.persona_name}</RetroBadge>
                          )}
                          <RetroBadge color={difficultyColor(sim.difficulty)}>
                            {difficultyLabel(sim.difficulty)}
                          </RetroBadge>
                          {typeof sim.goal_count === 'number' && sim.goal_count > 0 && (
                            <RetroBadge color="purple">
                              {sim.goal_count} goal
                              {sim.goal_count === 1 ? '' : 's'}
                            </RetroBadge>
                          )}
                        </div>
                      )}
                      <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
                        {s.message_count} messages · created {formatDate(s.created_at)} · updated{' '}
                        {formatDate(s.updated_at)}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className="text-retro-ink dark:text-retro-ink-dark text-xl font-semibold select-none"
                    >
                      →
                    </span>
                  </div>
                </RetroCard>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
