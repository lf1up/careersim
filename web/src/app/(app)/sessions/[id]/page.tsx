'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { NudgeResponse, SessionDetail } from '@/lib/types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroPanel } from '@/components/ui/RetroPanel';
import { RetroAlert, RetroBadge } from '@/components/ui/RetroBadge';
import { Button } from '@/components/ui/Button';
import { ChatTranscript } from '@/components/chat/ChatTranscript';
import { ChatComposer } from '@/components/chat/ChatComposer';

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [following, setFollowing] = useState(false);
  const [nudging, setNudging] = useState(false);
  // Optimistic echo of the message the user just sent. Cleared when the
  // server replaces local state (via the `done` event or a refetch).
  const [pendingHuman, setPendingHuman] = useState<string | null>(null);
  // True between "send pressed" and "first AI chunk arrives" — drives the
  // typing indicator.
  const [isWaiting, setIsWaiting] = useState(false);
  const [streamingAssistant, setStreamingAssistant] = useState<string | null>(null);
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
    busyRef.current =
      sending || following || isWaiting || streamingAssistant !== null;
  }, [sending, following, isWaiting, streamingAssistant]);

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
        | { type: 'message'; data: { role?: string; content?: string } & Record<string, unknown> }
        | { type: 'done'; data: { session?: SessionDetail } & Record<string, unknown> }
        | { type: 'error'; data: { message: string } },
        void,
        void
      >,
    ) => {
      let aiBuffer = '';
      try {
        for await (const event of stream) {
          if (event.type === 'message') {
            const role = (event.data.role as string | undefined) ?? 'ai';
            const content = (event.data.content as string | undefined) ?? '';
            if (role === 'ai' && content) {
              aiBuffer = aiBuffer ? `${aiBuffer}\n\n${content}` : content;
              // First AI chunk — swap the typing indicator for streaming text.
              setIsWaiting(false);
              setStreamingAssistant(aiBuffer);
            }
          } else if (event.type === 'done') {
            if (event.data.session) {
              setSession(event.data.session);
            }
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
        await runStream(stream);
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

  const handleFollowup = useCallback(async () => {
    setFollowing(true);
    setIsWaiting(true);
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const stream = apiClient.streamFollowup(sessionId, abort.signal);
      await runStream(stream);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setIsWaiting(false);
      toast.error(err instanceof Error ? err.message : 'Follow-up failed');
    } finally {
      setFollowing(false);
    }
  }, [runStream, sessionId]);

  const handleNudge = useCallback(async () => {
    setNudging(true);
    try {
      const res: NudgeResponse = await apiClient.nudge(sessionId);
      if (res.nudged) {
        setSession(res.session);
      } else {
        toast(`Nudge skipped: ${res.reason}`, { icon: 'ℹ️' });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nudge failed');
    } finally {
      setNudging(false);
    }
  }, [sessionId]);

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

  const busy =
    sending || following || nudging || isWaiting || streamingAssistant !== null;
  const nudgesDisabled =
    session.session_config.max_inactivity_nudges === 0 ||
    session.session_config.max_inactivity_nudges === null;

  return (
    <div className="space-y-4">
      <RetroCard
        title={session.simulation_slug}
        subtitle={
          <span className="font-monoRetro">
            Session {session.id.slice(0, 8)} · {session.messages.length} messages
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleFollowup}
              isLoading={following}
              disabled={busy && !following}
            >
              Follow up
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNudge}
              isLoading={nudging}
              disabled={(busy && !nudging) || nudgesDisabled}
              title={nudgesDisabled ? 'This persona has nudges disabled' : undefined}
            >
              Nudge
            </Button>
          </div>
        }
        bodyClassName="space-y-4"
      >
        <div className="flex flex-wrap gap-2">
          {session.session_config.typing_speed_wpm !== null && (
            <RetroBadge color="cyan">
              {session.session_config.typing_speed_wpm} wpm
            </RetroBadge>
          )}
          {session.session_config.starts_conversation && (
            <RetroBadge color="yellow">Persona opens</RetroBadge>
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

      <RetroPanel title="Transcript">
        <ChatTranscript
          messages={session.messages}
          pendingHuman={pendingHuman}
          pendingAssistant={streamingAssistant}
          isWaiting={isWaiting}
        />
      </RetroPanel>

      <RetroCard>
        <ChatComposer
          disabled={busy && !sending}
          sending={sending}
          onSend={handleSend}
        />
      </RetroCard>
    </div>
  );
}
