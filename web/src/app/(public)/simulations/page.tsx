'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { Simulation } from '@/lib/types';
import { difficultyColor, difficultyLabel } from '@/lib/simulation-meta';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroBadge } from '@/components/ui/RetroBadge';

export default function SimulationsPage() {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const sims = await apiClient.listSimulations();
        if (!cancelled) setSimulations(sims);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to load simulations',
          );
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return simulations;
    return simulations.filter((s) => {
      const haystack = [
        s.title,
        s.slug,
        s.persona_name,
        s.description ?? '',
        ...(s.skills_to_learn ?? []),
        ...(s.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [simulations, query]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 sm:pb-16 retro-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
            SIMULATIONS
          </h1>
          <p className="text-sm text-secondary-600 dark:text-secondary-400 mt-1">
            Pick a scenario to practice. Each one pairs you with a persona and a
            set of conversation goals.
          </p>
        </div>
        <div className="w-full sm:w-72">
          <label className="sr-only" htmlFor="simulation-search">
            Search simulations
          </label>
          <input
            id="simulation-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, skill, or tag…"
            className="retro-input w-full"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <RetroCard>
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            {simulations.length === 0
              ? 'No simulations available yet. Check back soon.'
              : `No simulations match “${query}”.`}
          </p>
        </RetroCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 retro-stagger">
          {filtered.map((sim) => (
            <Link
              key={sim.slug}
              href={`/simulations/${encodeURIComponent(sim.slug)}`}
              className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2"
            >
              <RetroCard
                className="flex flex-col h-full retro-card-interactive"
                bodyClassName="flex-1 flex flex-col"
                title={sim.title}
                subtitle={
                  <span className="font-monoRetro">{sim.slug}</span>
                }
              >
                <div className="flex-1 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <RetroBadge color="cyan">{sim.persona_name}</RetroBadge>
                    <RetroBadge color={difficultyColor(sim.difficulty)}>
                      {difficultyLabel(sim.difficulty)}
                    </RetroBadge>
                    {typeof sim.estimated_duration_minutes === 'number' && (
                      <RetroBadge color="default">
                        ~{sim.estimated_duration_minutes} min
                      </RetroBadge>
                    )}
                    {typeof sim.goal_count === 'number' && sim.goal_count > 0 && (
                      <RetroBadge color="purple">
                        {sim.goal_count} goal{sim.goal_count === 1 ? '' : 's'}
                      </RetroBadge>
                    )}
                  </div>

                  {sim.description && (
                    <p className="text-sm text-retro-ink dark:text-retro-ink-dark">
                      {sim.description}
                    </p>
                  )}

                  {sim.skills_to_learn && sim.skills_to_learn.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold tracking-wider2 text-secondary-600 dark:text-secondary-400 mb-1.5">
                        SKILLS
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {sim.skills_to_learn.slice(0, 5).map((skill) => (
                          <RetroBadge key={skill} color="teal">
                            {skill}
                          </RetroBadge>
                        ))}
                        {sim.skills_to_learn.length > 5 && (
                          <RetroBadge color="default">
                            +{sim.skills_to_learn.length - 5}
                          </RetroBadge>
                        )}
                      </div>
                    </div>
                  )}

                  {sim.tags && sim.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {sim.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[11px] font-monoRetro text-secondary-600 dark:text-secondary-400"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-end gap-2 text-xs font-semibold tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
                  <span>VIEW DETAILS</span>
                  <span aria-hidden className="text-base">→</span>
                </div>
              </RetroCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
