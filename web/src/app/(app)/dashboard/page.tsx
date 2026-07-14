'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';

import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/lib/api';
import type { AnalyticsOverview, SessionSummary, Simulation } from '@/lib/types';
import {
  difficultyColor,
  difficultyLabel,
  indexSimulations,
} from '@/lib/simulation-meta';
import { RetroBadge } from '@/components/ui/RetroBadge';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroPanel } from '@/components/ui/RetroPanel';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { ValueText } from '@/components/ui/ValueText';
import { SkillGauge, skillLabel } from '@/components/analytics/SkillGauge';

export default function DashboardPage() {
  const { user } = useAuth();
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [sims, sess, stats] = await Promise.all([
          apiClient.listSimulations(),
          apiClient.listSessions(),
          // Analytics are additive — if the call fails the dashboard
          // degrades to catalogue + sessions rather than erroring out.
          apiClient.getAnalyticsOverview().catch(() => null),
        ]);
        if (cancelled) return;
        setSimulations(sims);
        setSessions(sess);
        setOverview(stats);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load dashboard');
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

  // Hook calls must come before any early return.
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

  // Prefer the server-side aggregate; fall back to client-side counting
  // when the analytics call failed so the cards never show blanks.
  const totalMessages =
    overview?.totals.messages ??
    sessions.reduce((sum, s) => sum + s.message_count, 0);
  const sessionCount = overview?.totals.sessions ?? sessions.length;
  const recentSessions = [...sessions]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  const completionRate =
    overview && overview.goals.completion_rate !== null
      ? `${Math.round(overview.goals.completion_rate * 100)}%`
      : '—';
  const goalsAchieved = overview
    ? `${overview.goals.achieved}/${overview.goals.total}`
    : '—';
  const skillsSnapshot = overview?.reports.skill_averages ?? [];

  return (
    <div className="space-y-6 pb-3 sm:pb-4 retro-fade-in">
      <RetroCard
        title={<span className="font-retro tracking-wider2">WELCOME BACK</span>}
        subtitle={user?.email ?? 'Loading user...'}
      >
        <p className="text-retro-ink dark:text-retro-ink-dark">
          Pick a simulation to start a fresh chat, or continue one of your recent
          sessions.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/simulations">
            <Button variant="primary">Browse simulations</Button>
          </Link>
          <Link href="/sessions">
            <Button variant="outline">My sessions</Button>
          </Link>
          <Link href="/analytics">
            <Button variant="outline">Analytics</Button>
          </Link>
        </div>
      </RetroCard>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <RetroCard>
          <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 uppercase tracking-wider2">
            Your sessions
          </p>
          <p className="text-3xl mt-2">
            <ValueText value={sessionCount} />
          </p>
        </RetroCard>
        <RetroCard>
          <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 uppercase tracking-wider2">
            Completion rate
          </p>
          <p className="text-3xl mt-2">
            <ValueText value={completionRate} />
          </p>
          {overview && (
            <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 mt-1">
              {overview.goals.completed_sessions} of{' '}
              {overview.goals.completable_sessions} sessions
            </p>
          )}
        </RetroCard>
        <RetroCard>
          <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 uppercase tracking-wider2">
            Goals achieved
          </p>
          <p className="text-3xl mt-2">
            <ValueText value={goalsAchieved} />
          </p>
        </RetroCard>
        <RetroCard>
          <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 uppercase tracking-wider2">
            Messages exchanged
          </p>
          <p className="text-3xl mt-2">
            <ValueText value={totalMessages} />
          </p>
        </RetroCard>
      </div>

      {skillsSnapshot.length > 0 && (
        <RetroPanel
          title="Skills snapshot"
          right={
            <Link
              href="/analytics"
              className="text-sm underline text-primary-600 dark:text-primary-400"
            >
              Full analytics
            </Link>
          }
        >
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {skillsSnapshot.slice(0, 6).map((skill) => (
              <SkillGauge
                key={skill.key}
                compact
                label={skillLabel(skill.key)}
                score={skill.average}
              />
            ))}
          </div>
          <p className="mt-4 text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
            Averaged from {overview?.reports.analyzed_sessions} analyzed session
            {overview?.reports.analyzed_sessions === 1 ? '' : 's'}.
          </p>
        </RetroPanel>
      )}

      <RetroPanel
        title="Recent sessions"
        right={
          <Link href="/sessions" className="text-sm underline text-primary-600 dark:text-primary-400">
            View all
          </Link>
        }
      >
        {recentSessions.length === 0 ? (
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            No sessions yet. Kick one off from the{' '}
            <Link href="/simulations" className="underline text-primary-600 dark:text-primary-400">
              simulations page
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y-2 divide-black/10 dark:divide-retro-ink-dark/20 retro-stagger">
            {recentSessions.map((s) => {
              const sim = simulationBySlug[s.simulation_slug];
              const title = sim?.title ?? s.simulation_slug;
              return (
                <li key={s.id}>
                  <Link
                    href={`/sessions/${s.id}`}
                    className="group flex items-center justify-between gap-4 py-3 px-2 -mx-2 transition-[background-color,transform] duration-150 ease-out hover:bg-retro-paper dark:hover:bg-retro-surface-dark/40 hover:translate-x-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="font-semibold text-retro-ink dark:text-retro-ink-dark truncate">
                        {title}
                      </p>
                      {sim && (
                        <div className="flex flex-wrap items-center gap-1.5">
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
                        {s.message_count} messages · updated{' '}
                        {new Date(s.updated_at).toLocaleString()}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className="shrink-0 text-retro-ink dark:text-retro-ink-dark text-lg font-semibold select-none transition-transform duration-150 ease-out group-hover:translate-x-[3px]"
                    >
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </RetroPanel>
    </div>
  );
}
