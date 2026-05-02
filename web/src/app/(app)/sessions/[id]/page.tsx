'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { SessionDetail, SimulationDetail } from '@/lib/types';
import { SITE_NAME } from '@/lib/seo';
import { difficultyColor, difficultyLabel } from '@/lib/simulation-meta';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroPanel } from '@/components/ui/RetroPanel';
import { RetroAlert, RetroBadge } from '@/components/ui/RetroBadge';
import { ChatTranscript } from '@/components/chat/ChatTranscript';
import { ChatComposer } from '@/components/chat/ChatComposer';
import {
  GoalProgressChips,
  GoalProgressSummary,
} from '@/components/chat/GoalProgressTracker';

// Sleep for `ms`, resolving early if `signal` is aborted. Used to simulate
// the persona's typing pause between burst messages without leaving a dead
// timer running when the user starts another turn.
function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<SessionDetail | null>(null);
  // Catalogue entry for this session's simulation. Used to show the full
  // title and metadata pills in the header instead of just the raw slug.
  const [simulation, setSimulation] = useState<SimulationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Optimistic echo of the message the user just sent. Cleared when the
  // server replaces local state (via the `done` event or a refetch).
  const [pendingHuman, setPendingHuman] = useState<string | null>(null);
  // True between "send pressed" and "first AI chunk arrives" — drives the
  // typing indicator.
  const [isWaiting, setIsWaiting] = useState(false);
  const [streamingAssistant, setStreamingAssistant] = useState<string | null>(null);
  // Already-delivered AI messages from the current burst, rendered as
  // individual bubbles between `session.messages` and the in-flight
  // streamingAssistant bubble. We commit each prior message here as soon as
  // the next one starts so the typing indicator can appear in the gap.
  const [committedBurst, setCommittedBurst] = useState<string[]>([]);
  // Nudge auto-polling control:
  // - `permanentlyDisabled` flips on when the server says `nudges_disabled`
  //   (the persona opted out). Never resumes for this session.
  // - `pausedUntilHumanReply` flips on for `budget_exhausted` and clears on
  //   the next `handleSend`, since a human reply resets the server-side budget.
  const [nudgesPermanentlyDisabled, setNudgesPermanentlyDisabled] = useState(false);
  const [nudgesPausedUntilHumanReply, setNudgesPausedUntilHumanReply] = useState(false);
  const [goalsExpanded, setGoalsExpanded] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // Busy flag read *inside* the nudge-polling interval. Stored as a ref so the
  // interval doesn't get torn down & recreated on every streaming chunk.
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await apiClient.getSession(sessionId);
        if (cancelled) return;
        setSession(detail);
        // Fetch the matching simulation after we know the slug. Run it in
        // the background — a missing or failed lookup just degrades the
        // header to slug-only and must not block rendering the chat.
        apiClient
          .getSimulation(detail.simulation_slug)
          .then((sim) => {
            if (!cancelled) setSimulation(sim);
          })
          .catch(() => {
            // Swallow: the header will fall back to the raw slug.
          });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load session');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [sessionId]);

  useEffect(() => {
    document.title = simulation?.title
      ? `${simulation.title} Session | ${SITE_NAME}`
      : `Session | ${SITE_NAME}`;
  }, [simulation?.title]);

  // Keep `busyRef` current so the nudge-polling interval below can read it
  // without re-subscribing on every streaming chunk.
  useEffect(() => {
    busyRef.current = sending || isWaiting || streamingAssistant !== null;
  }, [sending, isWaiting, streamingAssistant]);

  // Inactivity-nudge auto-polling.
  //
  // The `api` service uses a pull model: it only fires a nudge when the client
  // sends `POST /sessions/:id/nudge`, and decides idempotently whether the
  // persona's `inactivityNudgeDelaySec` window has elapsed. Without this
  // ticker, the user never receives inactivity messages.
  //
  // Polling only runs when:
  //   - the persona has nudges enabled (`max_inactivity_nudges > 0`)
  //   - nothing is in-flight (checked via `busyRef` inside the tick, so the
  //     interval doesn't churn during streaming)
  //   - we haven't hit a terminal skip reason:
  //       * `nudges_disabled` → persona opted out, stop forever
  //       * `budget_exhausted` → stop until the next human reply resets budget
  const nudgesEnabled =
    session !== null &&
    session.session_config.max_inactivity_nudges !== null &&
    session.session_config.max_inactivity_nudges > 0;

  useEffect(() => {
    if (!nudgesEnabled) return;
    if (nudgesPermanentlyDisabled) return;
    if (nudgesPausedUntilHumanReply) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (busyRef.current) return;
      try {
        const res = await apiClient.nudge(sessionId);
        if (cancelled) return;
        if (res.nudged) {
          setSession(res.session);
        } else if (res.reason === 'nudges_disabled') {
          setNudgesPermanentlyDisabled(true);
        } else if (res.reason === 'budget_exhausted') {
          setNudgesPausedUntilHumanReply(true);
        }
        // `not_enough_idle` / `no_human_activity` / `agent_silent` → keep polling.
      } catch {
        // Swallow transient errors; a toast per missed tick would be noise.
      }
    };

    // Fire once immediately so a freshly-loaded session checks in without
    // waiting a full interval, then keep polling every 5s.
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    sessionId,
    nudgesEnabled,
    nudgesPermanentlyDisabled,
    nudgesPausedUntilHumanReply,
  ]);

  const runStream = useCallback(
    async (
      stream: AsyncGenerator<
        | {
            type: 'message';
            data: {
              role?: string;
              content?: string;
              typing_delay_sec?: number;
              is_followup?: boolean;
            } & Record<string, unknown>;
          }
        | { type: 'done'; data: { session?: SessionDetail } & Record<string, unknown> }
        | { type: 'error'; data: { message: string } },
        void,
        void
      >,
      signal: AbortSignal,
    ) => {
      // Local mirror of `committedBurst` so the paced loop has synchronous
      // access (React state updates are async and can't be read back in
      // the same tick).
      const localBurst: string[] = [];
      let currentStreaming: string | null = null;
      try {
        for await (const event of stream) {
          if (event.type === 'message') {
            const role = (event.data.role as string | undefined) ?? 'ai';
            const content = (event.data.content as string | undefined) ?? '';
            if (role !== 'ai' || !content) continue;

            // Follow-up within a burst: commit the previously-streamed
            // message as its own bubble, then show the typing indicator for
            // the agent-hinted `typing_delay_sec` before revealing this one.
            if (currentStreaming !== null) {
              localBurst.push(currentStreaming);
              setCommittedBurst([...localBurst]);
              currentStreaming = null;
              setStreamingAssistant(null);
              setIsWaiting(true);

              const rawDelay =
                typeof event.data.typing_delay_sec === 'number'
                  ? event.data.typing_delay_sec
                  : 0;
              // Cap at 6s so a pathological agent config can't freeze the UI,
              // and floor at 400ms so the indicator is visible even when the
              // hint is ~0 (still a real person "sending" another message).
              const delayMs = Math.min(
                Math.max(rawDelay * 1000, 400),
                6000,
              );
              await waitWithAbort(delayMs, signal);
              if (signal.aborted) return;
            }

            currentStreaming = content;
            setIsWaiting(false);
            setStreamingAssistant(currentStreaming);
          } else if (event.type === 'done') {
            if (event.data.session) {
              setSession(event.data.session);
            }
            setCommittedBurst([]);
            setStreamingAssistant(null);
            setPendingHuman(null);
            setIsWaiting(false);
            return;
          } else if (event.type === 'error') {
            throw new Error(event.data.message);
          }
        }
        // stream ended without a `done` event — fall back to a refetch.
        const latest = await apiClient.getSession(sessionId);
        setSession(latest);
      } finally {
        setCommittedBurst([]);
        setStreamingAssistant(null);
        setPendingHuman(null);
        setIsWaiting(false);
      }
    },
    [sessionId],
  );

  const handleSend = useCallback(
    async (content: string) => {
      setSending(true);
      setPendingHuman(content);
      setIsWaiting(true);
      // A human reply resets the server-side nudge budget, so re-arm polling.
      setNudgesPausedUntilHumanReply(false);
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        const stream = apiClient.streamMessage(sessionId, content, abort.signal);
        await runStream(stream, abort.signal);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        // Drop the optimistic bubble so the composer can re-populate for retry.
        setPendingHuman(null);
        setIsWaiting(false);
        const message =
          err instanceof Error ? err.message : 'Failed to send message';
        toast.error(message);
        throw err;
      } finally {
        setSending(false);
      }
    },
    [runStream, sessionId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-4">
        <RetroAlert tone="error" title="Session unavailable">
          {error ?? 'Unknown error'}
        </RetroAlert>
        <Link
          href="/sessions"
          className="underline text-primary-600 dark:text-primary-400"
        >
          Back to sessions
        </Link>
      </div>
    );
  }

  const hasTrackedGoals =
    session.goal_progress.length > 0 ||
    (simulation?.conversation_goals.length ?? 0) > 0;

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 retro-fade-in">
      <RetroCard
        className="shrink-0"
        headerClassName="!px-3 !py-3 sm:!px-6 sm:!py-4 gap-3"
        bodyClassName={goalsExpanded ? '!block !p-3 lg:!p-6' : 'hidden lg:block'}
        title={
          // Pills live inline *before* the title so the header's first row
          // immediately communicates "who you're talking to + how hard it
          // is" alongside the scenario name.
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
            <span className="hidden lg:inline">
              {session.simulation_slug} · Session {session.id.slice(0, 8)} ·{' '}
              {session.messages.length} messages
            </span>
            <span className="lg:hidden">
              Session {session.id.slice(0, 8)} · {session.messages.length} messages
            </span>
          </span>
        }
        actions={
          // Right-aligned compact progress bar in the header. Using the
          // card's `actions` slot means it sits flush with the title and
          // gets the free right-alignment we need, while the wider chips
          // list stays in the card body below.
          <>
            <GoalProgressSummary
              className="self-center"
              progress={session.goal_progress}
              goals={simulation?.conversation_goals}
            />
            {hasTrackedGoals && (
              <button
                type="button"
                className="lg:hidden px-2 py-1 border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark text-[10px] font-semibold uppercase tracking-wider2 shadow-retro-2 dark:shadow-retro-dark-2"
                aria-expanded={goalsExpanded}
                aria-controls="session-goals"
                onClick={() => setGoalsExpanded((open) => !open)}
              >
                {goalsExpanded ? 'Hide' : 'Show'}
              </button>
            )}
          </>
        }
      >
        <div id="session-goals">
          <GoalProgressChips
            progress={session.goal_progress}
            goals={simulation?.conversation_goals}
          />
        </div>
      </RetroCard>

      <RetroPanel
        className="flex-1 min-h-0 flex flex-col"
        bodyClassName="flex-1 min-h-0 flex flex-col"
      >
        <ChatTranscript
          messages={session.messages}
          pendingHuman={pendingHuman}
          burstedAssistant={committedBurst}
          pendingAssistant={streamingAssistant}
          isWaiting={isWaiting}
        />
      </RetroPanel>

      <RetroCard className="shrink-0">
        <ChatComposer sending={sending} onSend={handleSend} />
      </RetroCard>
    </div>
  );
}
