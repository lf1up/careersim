'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { simulationLabel } from '@/extensions';
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
import { SessionReportView } from '@/components/reports/SessionReportView';
import { RetroAlert, RetroBadge } from '@/components/ui/RetroBadge';
import { Button } from '@/components/ui/Button';
import { GoalProgressSummary } from '@/components/chat/GoalProgressTracker';

function formatDuration(totalSeconds: number | null | undefined): string | null {
  if (typeof totalSeconds !== 'number' || totalSeconds <= 0) return null;
  // Round first so values like 59.6 become 1m (not 0m 60s).
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
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

export default function SessionReportPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [openConversation,setOpenConversation]=useState(false);
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
    const controller = new AbortController();
    const load = async () => {
      try {
        const detail = await apiClient.getSession(sessionId, controller.signal);
        if (cancelled) return;
        setSession(detail);
        if (detail.assessment_mode === 'open') { setOpenConversation(true); return; }
        const report = await apiClient.getSessionReport(sessionId, controller.signal);
        if (cancelled) return;
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
        if (cancelled || controller.signal.aborted) return;
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
      controller.abort();
    };
  }, [sessionId]);


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

  if (openConversation) return <div className="space-y-4"><RetroAlert tone="info" title="Open conversation">This conversation has no scoring or debrief.</RetroAlert><Link href={`/sessions/${sessionId}`}><Button>Back to conversation</Button></Link></div>;

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

      <SessionReportView
        report={report}
        excerpts={session.messages}
        personaName={simulation?.persona_name}
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
            <span>
              {simulationLabel(session.simulation_slug, {
                catalogTitle: simulation?.title,
                title: session.simulation_title,
              })}
            </span>
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
        headerFooter={
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
        }
      />

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
