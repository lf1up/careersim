'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { AnalyticsOverview, Simulation } from '@/lib/types';
import { SITE_NAME } from '@/lib/seo';
import { indexSimulations } from '@/lib/simulation-meta';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroPanel } from '@/components/ui/RetroPanel';
import { RetroBadge } from '@/components/ui/RetroBadge';
import { RetroTable } from '@/components/ui/RetroTable';
import { Button } from '@/components/ui/Button';
import { ValueText } from '@/components/ui/ValueText';
import { SkillGauge, scoreBand, skillLabel } from '@/components/analytics/SkillGauge';

function formatPracticeTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <RetroCard>
      <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 uppercase tracking-wider2">
        {label}
      </p>
      <p className="text-3xl mt-2">
        <ValueText value={value} />
      </p>
      {hint && (
        <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 mt-1">
          {hint}
        </p>
      )}
    </RetroCard>
  );
}

/** Vertical bar strip for the score-over-time trend — pure CSS, no chart lib. */
function ScoreTrendStrip({ overview }: { overview: AnalyticsOverview }) {
  const trend = overview.reports.trend;
  if (trend.length < 2) return null;
  return (
    <RetroPanel title="Score over time">
      <p className="sr-only">
        Overall score per analyzed session, oldest to newest. Each bar links to
        that session&apos;s report.
      </p>
      <div className="flex items-end gap-2 h-40">
        {trend.map((point) => {
          const band = scoreBand(point.overall_score);
          return (
            <Link
              key={point.session_id}
              href={`/sessions/${point.session_id}/report`}
              className="group flex-1 flex flex-col items-center justify-end h-full min-w-0"
              title={`${point.simulation_slug} · ${formatDate(point.created_at)} · ${point.overall_score}/100`}
            >
              <span className="text-[10px] font-monoRetro text-secondary-600 dark:text-secondary-400 opacity-0 group-hover:opacity-100 transition-opacity">
                {point.overall_score}
              </span>
              <span
                className={`w-full max-w-10 border-2 border-black dark:border-retro-ink-dark ${band.bar} transition-[height] duration-500`}
                style={{ height: `${Math.max(4, point.overall_score)}%` }}
              />
            </Link>
          );
        })}
      </div>
      <p className="mt-3 text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
        Oldest → newest. Click a bar to open that session&apos;s report.
      </p>
    </RetroPanel>
  );
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = `Analytics | ${SITE_NAME}`;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [data, sims] = await Promise.all([
          apiClient.getAnalyticsOverview(),
          apiClient.listSimulations(),
        ]);
        if (!cancelled) {
          setOverview(data);
          setSimulations(sims);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load analytics');
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

  if (!overview) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-secondary-600 dark:text-secondary-400">
          Analytics are unavailable right now. Try refreshing the page.
        </p>
      </div>
    );
  }

  const { totals, goals, reports } = overview;
  const hasSessions = totals.sessions > 0;
  const unanalyzed = reports.total_sessions - reports.analyzed_sessions;

  return (
    <div className="space-y-6 pb-3 sm:pb-4 retro-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
            ANALYTICS
          </h1>
          <p className="text-sm text-secondary-600 dark:text-secondary-400 mt-1">
            How your practice is going, across every simulation and session.
          </p>
        </div>
        <Link href="/simulations">
          <Button variant="primary">Practice more</Button>
        </Link>
      </div>

      {!hasSessions ? (
        <RetroCard>
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            No sessions yet — there&apos;s nothing to analyze.{' '}
            <Link
              href="/simulations"
              className="underline text-primary-600 dark:text-primary-400"
            >
              Start your first simulation
            </Link>{' '}
            and come back here.
          </p>
        </RetroCard>
      ) : (
        <>
          {/* Headline cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Sessions"
              value={totals.sessions}
              hint={`${totals.simulations_tried} simulation${totals.simulations_tried === 1 ? '' : 's'} tried`}
            />
            <StatCard
              label="Completion rate"
              value={
                goals.completion_rate !== null
                  ? `${Math.round(goals.completion_rate * 100)}%`
                  : '—'
              }
              hint={`${goals.completed_sessions} of ${goals.completable_sessions} sessions completed`}
            />
            <StatCard
              label="Goals achieved"
              value={`${goals.achieved}/${goals.total}`}
              hint="required goals, all sessions"
            />
            <StatCard
              label="Practice time"
              value={formatPracticeTime(totals.practice_seconds)}
              hint={
                totals.voice_seconds > 0
                  ? `incl. ${formatPracticeTime(totals.voice_seconds)} on voice calls`
                  : `${totals.user_messages} messages sent`
              }
            />
          </div>

          {/* Skills */}
          <RetroPanel
            title="Skills"
            right={
              <span className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
                {reports.analyzed_sessions} of {reports.total_sessions} sessions
                analyzed
              </span>
            }
          >
            {reports.analyzed_sessions === 0 ? (
              <p className="text-sm text-secondary-600 dark:text-secondary-400">
                No session reports yet. Open a report from any{' '}
                <Link
                  href="/sessions"
                  className="underline text-primary-600 dark:text-primary-400"
                >
                  session
                </Link>{' '}
                to unlock skill scores, tone analysis, and trends here.
              </p>
            ) : (
              <div className="space-y-5">
                {reports.average_overall !== null && (
                  <div className="flex items-center gap-3">
                    <span className="text-4xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
                      {reports.average_overall}
                    </span>
                    <span className="text-xs font-monoRetro uppercase tracking-wider2 text-secondary-600 dark:text-secondary-400">
                      Average overall score
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
                  {reports.skill_averages.map((skill) => (
                    <SkillGauge
                      key={skill.key}
                      label={skillLabel(skill.key)}
                      score={skill.average}
                      rationale={`Across ${skill.count} analyzed session${skill.count === 1 ? '' : 's'}`}
                    />
                  ))}
                </div>
                {unanalyzed > 0 && (
                  <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
                    {unanalyzed} session{unanalyzed === 1 ? '' : 's'} without a
                    report yet — open them from{' '}
                    <Link
                      href="/sessions"
                      className="underline text-primary-600 dark:text-primary-400"
                    >
                      your sessions
                    </Link>{' '}
                    to include them.
                  </p>
                )}
              </div>
            )}
          </RetroPanel>

          {/* Trend */}
          <ScoreTrendStrip overview={overview} />

          {/* Tone + recurring feedback */}
          {reports.analyzed_sessions > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <RetroPanel title="Emotional tone">
                {reports.tones.length === 0 ? (
                  <p className="text-sm text-secondary-600 dark:text-secondary-400">
                    No tone data yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {reports.tones.map((tone) => (
                      <li key={tone.tone} className="flex items-center justify-between gap-2">
                        <RetroBadge color="purple">{tone.tone}</RetroBadge>
                        <span className="text-sm font-monoRetro text-secondary-600 dark:text-secondary-400">
                          ×{tone.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </RetroPanel>
              <RetroPanel title="Recurring strengths">
                {reports.top_strengths.length === 0 ? (
                  <p className="text-sm text-secondary-600 dark:text-secondary-400">
                    Nothing yet.
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {reports.top_strengths.map((item) => (
                      <li
                        key={item.text}
                        className="flex gap-2 text-sm text-retro-ink dark:text-retro-ink-dark"
                      >
                        <span aria-hidden className="shrink-0 font-monoRetro">
                          +
                        </span>
                        <span>
                          {item.text}
                          {item.count > 1 && (
                            <span className="ml-1 text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
                              ×{item.count}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </RetroPanel>
              <RetroPanel title="Focus areas">
                {reports.top_improvement_areas.length === 0 ? (
                  <p className="text-sm text-secondary-600 dark:text-secondary-400">
                    Nothing yet.
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {reports.top_improvement_areas.map((item) => (
                      <li
                        key={item.text}
                        className="flex gap-2 text-sm text-retro-ink dark:text-retro-ink-dark"
                      >
                        <span aria-hidden className="shrink-0 font-monoRetro">
                          △
                        </span>
                        <span>
                          {item.text}
                          {item.count > 1 && (
                            <span className="ml-1 text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
                              ×{item.count}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </RetroPanel>
            </div>
          )}

          {/* Per-simulation breakdown */}
          <RetroPanel title="By simulation">
            <RetroTable
              data={overview.per_simulation}
              keyExtractor={(row) => row.simulation_slug}
              columns={[
                {
                  key: 'simulation_slug',
                  header: 'Simulation',
                  render: (row) => (
                    <span className="font-semibold">
                      {simulationBySlug[row.simulation_slug]?.title ??
                        row.simulation_slug}
                    </span>
                  ),
                },
                {
                  key: 'sessions',
                  header: 'Attempts',
                  render: (row) => <ValueText value={row.sessions} />,
                },
                {
                  key: 'completed_sessions',
                  header: 'Completed',
                  render: (row) =>
                    row.completed_sessions > 0 ? (
                      <RetroBadge color="green">{row.completed_sessions}</RetroBadge>
                    ) : (
                      <span className="text-secondary-600 dark:text-secondary-400">
                        —
                      </span>
                    ),
                },
                {
                  key: 'best_goals_achieved',
                  header: 'Best goals',
                  render: (row) => (
                    <span className="font-monoRetro">
                      {row.goals_required > 0
                        ? `${row.best_goals_achieved}/${row.goals_required}`
                        : '—'}
                    </span>
                  ),
                },
                {
                  key: 'best_overall_score',
                  header: 'Best score',
                  render: (row) =>
                    row.best_overall_score !== null ? (
                      <span
                        className={`inline-block px-1.5 py-0.5 border-2 border-black dark:border-retro-ink-dark text-xs font-semibold ${scoreBand(row.best_overall_score).chip}`}
                      >
                        {row.best_overall_score}
                      </span>
                    ) : (
                      <span className="text-secondary-600 dark:text-secondary-400">
                        —
                      </span>
                    ),
                },
                {
                  key: 'last_played_at',
                  header: 'Last played',
                  render: (row) => (
                    <span className="font-monoRetro text-sm">
                      {formatDate(row.last_played_at)}
                    </span>
                  ),
                },
              ]}
            />
          </RetroPanel>
        </>
      )}
    </div>
  );
}
