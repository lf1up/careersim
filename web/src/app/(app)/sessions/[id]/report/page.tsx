'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { apiClient, ApiError } from '@/lib/api';
import type {
  DebriefReport,
  SessionDetail,
  SessionReportResponse,
  SimulationDetail,
} from '@/lib/types';
import { SITE_NAME } from '@/lib/seo';
import { difficultyColor, difficultyLabel } from '@/lib/simulation-meta';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroPanel } from '@/components/ui/RetroPanel';
import { RetroAlert, RetroBadge } from '@/components/ui/RetroBadge';
import { Button } from '@/components/ui/Button';
import { GoalProgressSummary } from '@/components/chat/GoalProgressTracker';
import { SkillGauge, scoreBand, skillLabel } from '@/components/analytics/SkillGauge';

function formatDuration(totalSeconds: number | null | undefined): string | null {
  if (typeof totalSeconds !== 'number' || totalSeconds <= 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes === 0) return `${seconds}s`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Big headline number with the band chip, used for the overall score. */
function OverallScore({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = scoreBand(clamped);
  return (
    <div className="flex items-center gap-3">
      <span className="text-5xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
        {clamped}
      </span>
      <div className="space-y-1">
        <span
          className={`inline-block px-2 py-0.5 border-2 border-black dark:border-retro-ink-dark text-xs font-semibold uppercase tracking-wider2 ${band.chip}`}
        >
          {band.label}
        </span>
        <p className="text-[10px] font-monoRetro uppercase tracking-wider2 text-secondary-600 dark:text-secondary-400">
          Overall / 100
        </p>
      </div>
    </div>
  );
}

function BulletPanel({
  title,
  items,
  marker,
}: {
  title: string;
  items: string[];
  marker: string;
}) {
  return (
    <RetroPanel title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-secondary-600 dark:text-secondary-400">
          Nothing highlighted for this session.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-sm text-retro-ink dark:text-retro-ink-dark">
              <span aria-hidden className="shrink-0 font-monoRetro">
                {marker}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </RetroPanel>
  );
}

const VOICE_METRICS: {
  key: string;
  label: string;
  format: (value: number) => string;
}[] = [
  { key: 'user_avg_wpm', label: 'Your pace', format: (v) => `${Math.round(v)} wpm` },
  {
    key: 'user_filler_density_per_100w',
    label: 'Fillers per 100 words',
    format: (v) => v.toFixed(1),
  },
  { key: 'user_filler_count', label: 'Filler words', format: (v) => String(Math.round(v)) },
  {
    key: 'user_avg_response_latency_sec',
    label: 'Avg response time',
    format: (v) => `${v.toFixed(1)}s`,
  },
  { key: 'longest_silence_sec', label: 'Longest silence', format: (v) => `${v.toFixed(1)}s` },
  {
    key: 'user_interrupt_count',
    label: 'Times you interrupted',
    format: (v) => String(Math.round(v)),
  },
];

export default function SessionReportPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [simulation, setSimulation] = useState<SimulationDetail | null>(null);
  const [reportRes, setReportRes] = useState<SessionReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMessages, setNeedsMessages] = useState(false);

  useEffect(() => {
    document.title = `Session Report | ${SITE_NAME}`;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // The report call can take several seconds on a cache miss (LLM
        // generation) — fire both in parallel so the transcript is ready
        // to resolve key-moment quotes the moment the report lands.
        const [detail, report] = await Promise.all([
          apiClient.getSession(sessionId),
          apiClient.getSessionReport(sessionId),
        ]);
        if (cancelled) return;
        setSession(detail);
        setReportRes(report);
        // Simulation metadata is cosmetic (title, persona pills) — load in
        // the background and degrade to the slug if it fails.
        apiClient
          .getSimulation(detail.simulation_slug)
          .then((sim) => {
            if (!cancelled) setSimulation(sim);
          })
          .catch(() => {});
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'NO_USER_MESSAGES') {
          setNeedsMessages(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load report');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const messagesByIndex = useMemo(() => {
    const map = new Map<number, { role: string; content: string }>();
    for (const m of session?.messages ?? []) {
      map.set(m.order_index, { role: m.role, content: m.content });
    }
    return map;
  }, [session?.messages]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 min-h-[50vh]">
        <LoadingSpinner size="lg" />
        <p className="text-sm font-monoRetro text-secondary-600 dark:text-secondary-400">
          Analyzing your conversation… this can take a few seconds.
        </p>
      </div>
    );
  }

  if (needsMessages) {
    return (
      <div className="space-y-4 retro-fade-in">
        <RetroAlert tone="info" title="Nothing to analyze yet">
          Send at least one message in this session, then come back for your
          report.
        </RetroAlert>
        <Link href={`/sessions/${sessionId}`}>
          <Button variant="primary">Open the conversation</Button>
        </Link>
      </div>
    );
  }

  if (error || !reportRes || !session) {
    return (
      <div className="space-y-4">
        <RetroAlert tone="error" title="Report unavailable">
          {error ?? 'Unknown error'}
        </RetroAlert>
        <Link
          href={`/sessions/${sessionId}`}
          className="underline text-primary-600 dark:text-primary-400"
        >
          Back to session
        </Link>
      </div>
    );
  }

  const report: DebriefReport = reportRes.report;
  const duration = formatDuration(report.stats.duration_seconds);
  const voiceEntries = report.voice
    ? VOICE_METRICS.filter((m) => typeof report.voice?.[m.key] === 'number')
    : [];

  return (
    <div className="space-y-6 pt-2 pb-3 sm:pt-0 sm:pb-4 retro-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/sessions">
          <Button variant="ghost" size="sm">
            ← All sessions
          </Button>
        </Link>
        <span className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
          {session.simulation_slug}
        </span>
      </div>

      {/* Header */}
      <RetroCard
        title={
          <span className="flex flex-wrap items-center gap-2 text-lg leading-tight sm:text-xl">
            {simulation?.persona_name && (
              <RetroBadge color="cyan">{simulation.persona_name}</RetroBadge>
            )}
            {simulation && (
              <RetroBadge color={difficultyColor(simulation.difficulty)}>
                {difficultyLabel(simulation.difficulty)}
              </RetroBadge>
            )}
            <span>{simulation?.title ?? session.simulation_slug}</span>
          </span>
        }
        subtitle={
          <span className="font-monoRetro">
            Session report · {report.stats.message_count} messages
            {duration ? ` · ${duration}` : ''} · generated{' '}
            {formatDate(report.generated_at)}
          </span>
        }
        actions={
          <div className="hidden sm:flex items-center gap-3">
            <GoalProgressSummary
              progress={session.goal_progress}
              goals={simulation?.conversation_goals}
            />
            <Link href={`/sessions/${sessionId}`}>
              <Button variant="outline" size="sm">
                Back to chat
              </Button>
            </Link>
          </div>
        }
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <OverallScore score={report.overall_score} />
          <div className="max-w-2xl space-y-2">
            {report.emotional_tone.overall && (
              <p className="text-xs font-monoRetro uppercase tracking-wider2 text-secondary-600 dark:text-secondary-400">
                Overall tone:{' '}
                <span className="text-retro-ink dark:text-retro-ink-dark font-semibold normal-case">
                  {report.emotional_tone.overall}
                </span>
              </p>
            )}
            {report.summary && (
              <p className="text-sm text-retro-ink dark:text-retro-ink-dark">
                {report.summary}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t-2 border-black/10 pt-3 dark:border-retro-ink-dark/20 sm:hidden">
          <GoalProgressSummary
            align="start"
            progress={session.goal_progress}
            goals={simulation?.conversation_goals}
          />
          <Link href={`/sessions/${sessionId}`}>
            <Button variant="outline" size="sm">
              Back to chat
            </Button>
          </Link>
        </div>
      </RetroCard>

      {/* Skill gauges */}
      <RetroPanel title="Skill scores">
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
          {report.skills.map((skill) => (
            <SkillGauge
              key={skill.key}
              label={skillLabel(skill.key)}
              score={skill.score}
              rationale={skill.rationale}
            />
          ))}
        </div>
        {report.goal_outcome && (
          <p className="mt-5 text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
            Goals: {report.goal_outcome.achieved_required} of{' '}
            {report.goal_outcome.required} required achieved
            {report.goal_outcome.total > report.goal_outcome.required
              ? ` · ${report.goal_outcome.achieved_total} of ${report.goal_outcome.total} overall`
              : ''}
          </p>
        )}
      </RetroPanel>

      {/* Emotional tone journey */}
      {report.emotional_tone.journey.length > 0 && (
        <RetroPanel title="Emotional tone journey">
          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {report.emotional_tone.journey.map((phase, idx) => (
              <li
                key={idx}
                className="border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark p-4 shadow-retro-2 dark:shadow-retro-dark-2 space-y-2"
              >
                <p className="text-[10px] font-monoRetro uppercase tracking-wider2 text-secondary-600 dark:text-secondary-400">
                  {idx + 1}. {phase.phase || `Phase ${idx + 1}`}
                </p>
                <RetroBadge color="purple">{phase.tone}</RetroBadge>
                {phase.note && (
                  <p className="text-xs text-retro-ink dark:text-retro-ink-dark">
                    {phase.note}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </RetroPanel>
      )}

      {/* Strengths / improvements / advice */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BulletPanel title="Strengths" items={report.strengths} marker="+" />
        <BulletPanel
          title="Improvement areas"
          items={report.improvement_areas}
          marker="△"
        />
        <BulletPanel title="Advice" items={report.advice} marker="→" />
      </div>

      {/* Key moments */}
      {report.key_moments.length > 0 && (
        <RetroPanel title="Key moments">
          <ul className="space-y-4">
            {report.key_moments.map((moment, idx) => {
              const message = messagesByIndex.get(moment.message_index);
              const isUser = (message?.role ?? moment.role) === 'human';
              return (
                <li
                  key={idx}
                  className="border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark p-4 shadow-retro-2 dark:shadow-retro-dark-2 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <RetroBadge color={isUser ? 'yellow' : 'cyan'}>
                      {isUser ? 'You' : simulation?.persona_name ?? 'Persona'}
                    </RetroBadge>
                    <span className="text-sm font-semibold text-retro-ink dark:text-retro-ink-dark">
                      {moment.label}
                    </span>
                  </div>
                  {message && (
                    <blockquote className="border-l-4 border-black/20 dark:border-retro-ink-dark/30 pl-3 text-sm italic text-secondary-700 dark:text-secondary-300">
                      “{message.content}”
                    </blockquote>
                  )}
                  {moment.note && (
                    <p className="text-xs text-secondary-600 dark:text-secondary-400">
                      {moment.note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </RetroPanel>
      )}

      {/* Voice signals */}
      {voiceEntries.length > 0 && (
        <RetroPanel title="Voice signals">
          <p className="mb-4 text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
            Measured during the voice call in this session.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {voiceEntries.map((metric) => (
              <div key={metric.key}>
                <p className="text-[10px] font-monoRetro uppercase tracking-wider2 text-secondary-600 dark:text-secondary-400">
                  {metric.label}
                </p>
                <p className="text-xl font-monoRetro text-retro-ink dark:text-retro-ink-dark mt-1">
                  {metric.format(report.voice?.[metric.key] as number)}
                </p>
              </div>
            ))}
          </div>
        </RetroPanel>
      )}

      <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
        Reports refresh automatically after the conversation advances.{' '}
        <Link
          href="/analytics"
          className="underline text-primary-600 dark:text-primary-400"
        >
          See your overall analytics →
        </Link>
      </p>
    </div>
  );
}
