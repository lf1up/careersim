'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { SessionDetail } from '@/lib/types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroPanel } from '@/components/ui/RetroPanel';
import { RetroAlert, RetroBadge } from '@/components/ui/RetroBadge';
import { ChatTranscript } from '@/components/chat/ChatTranscript';
import { ChatComposer } from '@/components/chat/ChatComposer';

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

  const abortRef = useRef<AbortController | null>(null);
  // Busy flag read *inside* the nudge-polling interval. Stored as a ref so the
  // interval doesn't get torn down & recreated on every streaming chunk.
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await apiClient.getSession(sessionId);
        if (!cancelled) setSession(detail);
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

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 retro-fade-in">
      <RetroCard
        className="shrink-0"
        title={session.simulation_slug}
        subtitle={
          <span className="font-monoRetro">
            Session {session.id.slice(0, 8)} · {session.messages.length} messages
          </span>
        }
        bodyClassName="space-y-4"
      >
        <div className="flex flex-wrap gap-2">
          {session.session_config.typing_speed_wpm !== null && (
            <RetroBadge color="cyan">
              {session.session_config.typing_speed_wpm} wpm
            </RetroBadge>
          )}
          {session.session_config.starts_conversation === true && (
            <RetroBadge color="yellow">Persona opens</RetroBadge>
          )}
          {session.session_config.starts_conversation === 'sometimes' && (
            <RetroBadge color="yellow">Persona sometimes opens</RetroBadge>
          )}
          {session.session_config.max_inactivity_nudges != null &&
            session.session_config.max_inactivity_nudges > 0 && (
              <RetroBadge color="amber">
                {session.session_config.max_inactivity_nudges} nudges max
              </RetroBadge>
            )}
          {/*
           * Persona `burstiness.max` is the total burst size (initial message
           * + up to N-1 follow-ups). Mirror the nudge badge's semantics by
           * reporting the additional-followup cap (burst.max - 1), and hide
           * it when the persona never follows up (burst.max <= 1).
           */}
          {session.session_config.burstiness != null &&
            session.session_config.burstiness.max > 1 && (
              <RetroBadge color="purple">
                {session.session_config.burstiness.max - 1} followups max
              </RetroBadge>
            )}
        </div>
      </RetroCard>

      <RetroPanel
        title="Transcript"
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
