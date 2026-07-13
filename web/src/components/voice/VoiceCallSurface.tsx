'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import toast from 'react-hot-toast';

import { apiClient, ApiError } from '@/lib/api';
import { createVoiceConnection, type VoiceConnection } from '@/lib/voice';
import type { VoiceCaption } from '@/lib/types';
import { RetroAlert } from '@/components/ui/RetroBadge';

import { VoiceControls } from './VoiceControls';

export interface VoiceCallSurfaceProps {
  sessionId: string;
  personaName?: string;
  /** Called when the user (or an error) ends the call. The parent should
   *  swap back to the chat surface and refetch the session detail. */
  onCallEnded: () => void;
}

type Status = 'connecting' | 'live' | 'reconnecting' | 'ended';

// Upper bound on bubbles kept per caption stack. The full history lives in
// the persisted transcript; the live surface only needs the recent context.
// Without a cap, a long uncommitted batch (an interrupt-happy user) would
// grow the stacks without limit.
const MAX_VISIBLE_CAPTIONS = 6;

// Elapsed call seconds, guarded against a missing live start. When the
// call ends before the LiveKit connection comes up, `startMs` is still
// 0; subtracting that from `Date.now()` would yield a bogus multi-billion
// second debit, so treat the duration as 0 in that case (and clamp any
// negative skew to 0).
function elapsedCallSeconds(startMs: number): number {
  if (startMs <= 0) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}

/**
 * Full-bleed surface that takes over the chat area while a voice call
 * is active. Replaces (not overlays) the transcript so the user has
 * an unambiguous "I'm in a call now" mode. Live captions stack every
 * persona bubble of the current turn (the main reply plus any follow-up
 * bursts) at the top with the user's utterances underneath. BOTH sides
 * accumulate: rapid speech split into several utterances shows as
 * several stacked "You" bubbles — matching how the worker batches them
 * into one turn and how they persist to the transcript — instead of
 * each new utterance overwriting the previous one. Turn boundaries are
 * driven by the worker's `turn_committed` / `turn_superseded` control
 * events: both stacks clear when the user speaks after a COMMITTED
 * turn, and abandoned (re-run) replies drop their stale AI bubbles.
 */
export function VoiceCallSurface({
  sessionId,
  personaName,
  onCallEnded,
}: VoiceCallSurfaceProps) {
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // All AI caption bubbles for the *current* persona turn. The worker
  // streams multi-bubble replies (the main message plus any follow-up
  // bursts) as separate final captions; we accumulate them so a follow-up
  // never replaces the main message on screen. Cleared when the user
  // starts a new turn.
  const [aiCaptions, setAiCaptions] = useState<VoiceCaption[]>([]);
  // Finalised user utterances of the current turn. The voice worker
  // batches every utterance spoken before the persona replies into ONE
  // turn, so we stack them all instead of keeping only the latest.
  const [userCaptions, setUserCaptions] = useState<VoiceCaption[]>([]);
  // Live (non-final) transcription bubble shown under the finalised ones.
  const [interimUserCaption, setInterimUserCaption] =
    useState<VoiceCaption | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  // True while the persona's reply is being generated — i.e. the user
  // finished an utterance but the AI caption hasn't landed yet. Drives
  // the "cooking a reply" animation so the call never looks frozen.
  const [isThinking, setIsThinking] = useState(false);

  // Keep the connection + start-time around in refs so unmount cleanup
  // can disconnect synchronously without going through React state.
  // `startTimeRef` is initialised to 0 and overwritten the moment the
  // LiveKit connection comes up — initialising with `Date.now()` here
  // would re-evaluate on every re-render and trip React's purity rule.
  const connRef = useRef<VoiceConnection | null>(null);
  const startTimeRef = useRef<number>(0);
  const endingRef = useRef<boolean>(false);
  // Scrollable caption viewport. Which way it auto-scrolls depends on who
  // produced the newest caption: user bubbles sit at the BOTTOM of the
  // stack (scroll down to follow speech), persona bubbles sit above them
  // (scroll up to the newest reply bubble as it is spoken).
  const captionScrollRef = useRef<HTMLDivElement | null>(null);
  const lastAiBubbleRef = useRef<HTMLDivElement | null>(null);
  const lastCaptionSideRef = useRef<'user' | 'ai'>('user');
  // Set when the agent worker signals the daily budget is spent, so the
  // subsequent room disconnect is shown as a clean "limit reached" end
  // rather than the unsolicited-drop "reconnecting" path.
  const quotaEndedRef = useRef<boolean>(false);
  // True once the worker confirmed the current turn was COMMITTED
  // (persisted server-side) — the next finalised utterance then starts a
  // fresh turn (clearing both caption stacks) instead of extending the
  // answered one. Driven by the worker's `turn_committed` control event,
  // NOT by AI captions arriving: with abandon-and-rerun, spoken bubbles
  // can belong to a reply that is later abandoned, in which case the
  // user's next utterance still extends the SAME turn.
  const turnCommittedRef = useRef<boolean>(false);

  const personaLabel = useMemo(() => personaName ?? 'persona', [personaName]);

  // Mount: open the connection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await apiClient.startVoiceCall(sessionId);
        if (cancelled) return;
        setQuotaRemaining(meta.quota_remaining_seconds);

        const conn = await createVoiceConnection({
          url: meta.livekit_url,
          token: meta.token,
        });
        if (cancelled) {
          await conn.disconnect();
          return;
        }
        connRef.current = conn;
        startTimeRef.current = Date.now();
        setStatus('live');

        // Listen for caption frames published by the agent worker.
        const unsubscribe = conn.onCaption((c) => {
          if (c.role === 'ai') {
            // Each non-empty AI caption is one bubble of the persona's
            // reply (main message or a follow-up burst). Append rather
            // than replace so the whole multi-bubble reply stays visible.
            // The worker also emits an empty final caption at call end —
            // ignore those so we don't push a blank bubble.
            if (c.text && c.text.trim()) {
              lastCaptionSideRef.current = 'ai';
              setAiCaptions((prev) => [...prev, c].slice(-MAX_VISIBLE_CAPTIONS));
              // The reply is landing — stop the "cooking" animation.
              setIsThinking(false);
            }
          } else if (c.is_final) {
            lastCaptionSideRef.current = 'user';
            setInterimUserCaption(null);
            if (c.text.trim()) {
              if (turnCommittedRef.current) {
                // First utterance of a NEW turn — clear the committed
                // turn's bubbles on both sides.
                turnCommittedRef.current = false;
                setAiCaptions([]);
                setUserCaptions([c]);
              } else {
                // Another utterance for the same pending turn. The worker
                // batches these into one reply, so stack it under the
                // previous ones instead of overwriting.
                setUserCaptions((prev) => [...prev, c].slice(-MAX_VISIBLE_CAPTIONS));
              }
              // The server is (re)generating the reply — show the
              // "cooking" indicator until the next AI caption lands.
              setIsThinking(true);
            }
          } else {
            // Fresh interim user speech — they're talking again, not
            // waiting on a reply.
            lastCaptionSideRef.current = 'user';
            setInterimUserCaption(c);
            setIsThinking(false);
          }
        });

        // Listen for control events: turn lifecycle (caption grouping)
        // and budget (warning + hard cutoff).
        const unsubscribeControl = conn.onControl((event) => {
          if (event.type === 'turn_committed') {
            // The turn (user batch + persona reply) is persisted; the
            // next user utterance starts a fresh caption group.
            turnCommittedRef.current = true;
          } else if (event.type === 'turn_superseded') {
            // The in-flight reply was abandoned because the user kept
            // talking. Its already-spoken bubbles will never persist —
            // drop them and show "cooking" for the re-run. The user
            // caption stack stays: those utterances still belong to the
            // (continuing) current turn.
            lastCaptionSideRef.current = 'user';
            setAiCaptions([]);
            setIsThinking(true);
          } else if (event.type === 'quota_warning') {
            toast('About a minute of daily voice time left.', { icon: '\u23F3' });
          } else if (event.type === 'quota_exhausted') {
            // Mark this so the imminent room disconnect is presented as a
            // clean limit-reached end instead of a reconnect attempt.
            quotaEndedRef.current = true;
            const message = formatLimitReached(event.cap_seconds);
            setError(message);
            toast.error(message);
          }
        });

        // The Room emits `Disconnected` either on a clean end-call or
        // an unexpected drop; either way we leave the surface.
        const lk = await import('livekit-client');
        conn.room.on(lk.RoomEvent.Disconnected, () => {
          // The persona can't be "cooking" once the room is gone.
          setIsThinking(false);
          // If the user pressed End call, the cleanup path handles it.
          if (endingRef.current) return;
          // Budget cutoff: the worker tore the room down on purpose.
          // Skip the "reconnecting" dance and end cleanly.
          if (quotaEndedRef.current) {
            setStatus('ended');
            onCallEnded();
            return;
          }
          // Otherwise this was an unsolicited disconnect (network drop,
          // or the agent worker died mid-call). Flip to `reconnecting`
          // briefly, then end. We also fire a best-effort `/voice/end`
          // so the server-side single-active-call guard clears — a
          // killed worker never reports its own end, which would
          // otherwise leave the session marked "in progress" and block
          // the next /voice/start until the staleness window expires.
          setStatus('reconnecting');
          window.setTimeout(() => {
            if (!endingRef.current) {
              endingRef.current = true;
              const seconds = elapsedCallSeconds(startTimeRef.current);
              void apiClient.endVoiceCall(sessionId, seconds).catch(() => {
                // Best-effort — the staleness window is the backstop.
              });
              setStatus('ended');
              onCallEnded();
            }
          }, 1500);
        });

        return () => {
          unsubscribe();
          unsubscribeControl();
        };
      } catch (err) {
        if (cancelled) return;
        const message = formatStartError(err);
        setError(message);
        setStatus('ended');
        toast.error(message);
        onCallEnded();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, onCallEnded]);

  // Tick the elapsed clock every second.
  useEffect(() => {
    if (status !== 'live' && status !== 'reconnecting') return;
    const id = window.setInterval(() => {
      setElapsed(elapsedCallSeconds(startTimeRef.current));
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // Safety net: never let the "cooking" indicator hang past ~45s if a
  // reply never arrives (LLM error, dropped/superseded turn). Only arms
  // while live + thinking, and only mutates state from the timeout
  // callback (not synchronously in the effect body). Transitions away
  // from `live` clear `isThinking` at their source (end/disconnect).
  useEffect(() => {
    if (status !== 'live' || !isThinking) return;
    const id = window.setTimeout(() => setIsThinking(false), 45000);
    return () => window.clearTimeout(id);
  }, [status, isThinking]);

  // Auto-scroll the caption viewport toward the side that spoke last:
  // down to the bottom while the USER is talking (their bubbles are the
  // lowest in the stack), up to the newest PERSONA bubble while the reply
  // is being spoken (its bubbles sit above the user's). The stacks are
  // capped and the viewport scrolls, so the surface can never overflow
  // its panel no matter how long an uncommitted batch gets.
  useEffect(() => {
    const el = captionScrollRef.current;
    if (!el) return;
    if (lastCaptionSideRef.current === 'ai') {
      const bubble = lastAiBubbleRef.current;
      // Align the newest reply bubble just under the top fade so the
      // persona's words are read from where they start.
      const top = bubble ? Math.max(0, bubble.offsetTop - 32) : 0;
      el.scrollTo({ top, behavior: 'smooth' });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [aiCaptions, userCaptions, interimUserCaption, isThinking]);

  // Cleanup: disconnect on unmount.
  useEffect(() => {
    return () => {
      const conn = connRef.current;
      if (!conn) return;
      void conn.disconnect();
    };
  }, []);

  const handleEnd = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setIsThinking(false);
    setStatus('ended');
    const seconds = elapsedCallSeconds(startTimeRef.current);
    try {
      await connRef.current?.disconnect();
    } catch {
      // disconnection errors are non-fatal
    }
    try {
      const result = await apiClient.endVoiceCall(sessionId, seconds);
      setQuotaRemaining(result.quota_remaining_seconds);
    } catch {
      // Best-effort — if /voice/end fails the SFU close still
      // releases server resources; the next /voice/start will
      // re-check ownership + quota.
    }
    onCallEnded();
  }, [onCallEnded, sessionId]);

  const handleToggleMute = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    const next = !isMuted;
    setIsMuted(next);
    try {
      await conn.room.localParticipant.setMicrophoneEnabled(!next);
    } catch {
      // Revert on hardware/permission failure.
      setIsMuted(!next);
    }
  }, [isMuted]);

  return (
    <div className="flex flex-col gap-2 sm:gap-3 h-full min-h-0">
      {/* The full explainer is several lines tall on a phone and starves
          the caption area of height — small screens get a one-liner. */}
      <RetroAlert tone="info" className="!p-2 sm:!p-4">
        <span className="hidden sm:inline">
          Voice mode is on. Calls aren&rsquo;t recorded — only the live
          transcript is persisted to your session history. Press{' '}
          <kbd className="px-1 border-2 border-black dark:border-retro-ink-dark">End call</kbd>{' '}
          when you&rsquo;re done.
        </span>
        <span className="sm:hidden text-xs">
          Voice mode is on — only the live transcript is saved.
        </span>
      </RetroAlert>

      <div className="flex-1 min-h-0 flex flex-col items-center gap-2 sm:gap-4 border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark px-3 pt-3 pb-3 sm:px-6 sm:pt-10 sm:pb-6 shadow-retro-2 dark:shadow-retro-dark-2 overflow-hidden">
        <div className="text-center shrink-0 sm:mt-8">
          <div className="text-[10px] sm:text-xs uppercase tracking-wider2 text-retro-ink-mute dark:text-retro-ink-mute-dark font-monoRetro mb-1 sm:mb-2">
            Speaking with
          </div>
          <div className="text-lg sm:text-2xl font-display font-bold leading-tight">
            {personaLabel}
          </div>
        </div>

        {/* Captions live in their own scroll viewport (pinned to the newest
            bubble), so a long exchange scrolls inside the panel instead of
            blowing the layout open. The gradient mask fades bubbles out at
            the viewport edges — a soft reveal instead of a hard crop — and
            the scrollbar is hidden since the view auto-follows the call. */}
        <div
          ref={captionScrollRef}
          // `relative` so bubble offsetTop is measured against this
          // viewport (the direction-aware auto-scroll depends on it).
          className="relative flex-1 min-h-0 w-full max-w-xl overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_bottom,transparent,black_28px,black_calc(100%-28px),transparent)]"
        >
          {/* min-h-full + justify-center keeps a short exchange vertically
              centered in the panel; once it outgrows the viewport it simply
              scrolls. py gives the first/last bubble clearance from the
              fade mask so resting content never looks cut off. */}
          <div
            className="min-h-full flex flex-col justify-center space-y-2 sm:space-y-3 py-4 sm:py-8"
            aria-live="polite"
          >
          {aiCaptions.map((c, i) => (
            <div
              key={i}
              ref={i === aiCaptions.length - 1 ? lastAiBubbleRef : undefined}
              className="border-2 border-black dark:border-retro-ink-dark bg-retro-paper dark:bg-retro-paper-dark p-3"
            >
              {/* Label the persona once, on the first bubble, so a stacked
                  multi-bubble reply reads as one grouped turn. */}
              {i === 0 && (
                <div className="text-[10px] uppercase tracking-wider2 font-monoRetro text-retro-ink-mute dark:text-retro-ink-mute-dark mb-1">
                  {personaLabel}
                </div>
              )}
              <div className="text-sm leading-snug">{c.text}</div>
            </div>
          ))}
          {isThinking && <ThinkingIndicator personaLabel={personaLabel} />}
          {userCaptions.map(
            (c, i) =>
              c.text && (
                <div
                  key={i}
                  className="border-2 border-black dark:border-retro-ink-dark bg-retro-accent/30 dark:bg-retro-accent-dark/30 p-3"
                >
                  {/* Label once, on the first bubble, so stacked utterances
                      read as one grouped turn (mirrors the persona side). */}
                  {i === 0 && (
                    <div className="text-[10px] uppercase tracking-wider2 font-monoRetro text-retro-ink-mute dark:text-retro-ink-mute-dark mb-1">
                      You
                    </div>
                  )}
                  <div className="text-sm leading-snug">{c.text}</div>
                </div>
              ),
          )}
          {interimUserCaption && interimUserCaption.text && (
            <div className="border-2 border-black dark:border-retro-ink-dark bg-retro-accent/30 dark:bg-retro-accent-dark/30 p-3">
              <div className="text-[10px] uppercase tracking-wider2 font-monoRetro text-retro-ink-mute dark:text-retro-ink-mute-dark mb-1">
                You (transcribing…)
              </div>
              <div className="text-sm leading-snug">
                {interimUserCaption.text}
              </div>
            </div>
          )}
          </div>
        </div>

        {error && (
          <RetroAlert tone="error" title="Voice unavailable">
            {error}
          </RetroAlert>
        )}
      </div>

      <VoiceControls
        status={status}
        elapsedSeconds={elapsed}
        quotaRemainingSeconds={quotaRemaining}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        onEndCall={handleEnd}
      />
    </div>
  );
}

/**
 * Animated placeholder shown in the persona's caption slot while the
 * reply is being generated (between the user's final transcript and the
 * AI caption). Mirrors the AI caption bubble's chrome so the reply text
 * lands in the exact same spot the "cooking" dots occupied.
 */
function ThinkingIndicator({ personaLabel }: { personaLabel: string }) {
  return (
    <div
      className="border-2 border-black dark:border-retro-ink-dark bg-retro-paper dark:bg-retro-paper-dark p-3"
      role="status"
      aria-live="polite"
      aria-label={`${personaLabel} is typing`}
    >
      <div className="text-[10px] uppercase tracking-wider2 font-monoRetro text-retro-ink-mute dark:text-retro-ink-mute-dark mb-1">
        {personaLabel}
      </div>
      {/* Same three-dot "typing" wave as the chat TypingIndicator so the
          two surfaces feel consistent. */}
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {['0ms', '150ms', '300ms'].map((delay) => (
          <span
            key={delay}
            className="inline-block w-2 h-2 rounded-full bg-retro-ink dark:bg-retro-ink-dark animate-bounce motion-reduce:animate-none"
            style={{ animationDelay: delay }}
          />
        ))}
      </span>
    </div>
  );
}

/**
 * Map an `ApiError` from `/voice/start` into a user-friendly message.
 * The codes mirror what the API service throws — see
 * `api/src/modules/voice/voice.service.ts`.
 */
function formatStartError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'voice_disabled') {
      return 'Voice mode is currently disabled. Please continue in text.';
    }
    if (err.code === 'voice_misconfigured') {
      return 'Voice mode is enabled but the LiveKit configuration is incomplete.';
    }
    if (err.code === 'voice_quota_exhausted') {
      return 'Daily voice budget reached. The quota resets at midnight UTC.';
    }
    if (err.code === 'voice_call_in_progress') {
      return 'You already have a voice call in progress. End it before starting another.';
    }
    return err.message;
  }
  if (err instanceof Error && err.message.toLowerCase().includes('permission')) {
    return 'Microphone permission was denied. Allow microphone access in your browser to use voice mode.';
  }
  if (err instanceof Error) return err.message;
  return 'Failed to start the voice call.';
}

/**
 * Copy for the daily-budget hard cutoff. Derives the minutes figure
 * from the worker-supplied `cap_seconds` when available so it always
 * reflects the configured limit rather than a hardcoded number.
 */
function formatLimitReached(capSeconds?: number | null): string {
  if (typeof capSeconds === 'number' && capSeconds > 0) {
    const minutes = Math.round(capSeconds / 60);
    return `Daily ${minutes}-minute voice limit reached. Resets at midnight UTC.`;
  }
  return 'Daily voice limit reached. Resets at midnight UTC.';
}
