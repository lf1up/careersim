'use client';

import React, { useMemo, type ReactNode } from 'react';
import type { DebriefReport } from '@/lib/types';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroPanel } from '@/components/ui/RetroPanel';
import { RetroBadge } from '@/components/ui/RetroBadge';
import { SkillGauge, scoreBand, skillLabel } from '@/components/analytics/SkillGauge';

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

export interface ReportExcerpt {
  order_index: number;
  role: string;
  content: string;
  actor_name?: string | null;
}

/** Report presentation shared by participant and authorized creator views. */
export function SessionReportView({ report, title, subtitle, actions, headerFooter, excerpts = [], personaName, userLabel = 'You' }: {
  report: DebriefReport;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  headerFooter?: ReactNode;
  excerpts?: ReportExcerpt[];
  personaName?: string;
  userLabel?: string;
}) {
  const messagesByIndex = useMemo(() => new Map(excerpts.map((m) => [m.order_index, m])), [excerpts]);
  const voiceEntries = report.voice ? VOICE_METRICS.filter((m) => typeof report.voice?.[m.key] === 'number') : [];
  return <div className="space-y-6">
      <RetroCard title={title} subtitle={subtitle} actions={actions}>
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
        {headerFooter}
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
                      {isUser ? userLabel : message?.actor_name ?? personaName ?? 'Persona'}
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

  </div>;
}
