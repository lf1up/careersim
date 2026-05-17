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

/**
 * Full-bleed surface that takes over the chat area while a voice call
 * is active. Replaces (not overlays) the transcript so the user has
 * an unambiguous "I'm in a call now" mode. Live captions stack the
 * latest persona reply at the top with the user's last utterance
 * underneath, both clearing on `is_final=true` plus a short fade
 * window.
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
  const [aiCaption, setAiCaption] = useState<VoiceCaption | null>(null);
  const [userCaption, setUserCaption] = useState<VoiceCaption | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);

  // Keep the connection + start-time around in refs so unmount cleanup
  // can disconnect synchronously without going through React state.
  // `startTimeRef` is initialised to 0 and overwritten the moment the
  // LiveKit connection comes up — initialising with `Date.now()` here
  // would re-evaluate on every re-render and trip React's purity rule.
  const connRef = useRef<VoiceConnection | null>(null);
  const startTimeRef = useRef<number>(0);
  const endingRef = useRef<boolean>(false);

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
          if (c.role === 'ai') setAiCaption(c);
          else setUserCaption(c);
        });

        // The Room emits `Disconnected` either on a clean end-call or
        // an unexpected drop; either way we leave the surface.
        const lk = await import('livekit-client');
        conn.room.on(lk.RoomEvent.Disconnected, () => {
          // If the user pressed End call, the cleanup path handles it.
          // If we got here without that flag set, this was an unsolicited
          // disconnect — flip to `reconnecting` briefly, then end.
          if (!endingRef.current) {
            setStatus('reconnecting');
            window.setTimeout(() => {
              if (!endingRef.current) {
                setStatus('ended');
                onCallEnded();
              }
            }, 1500);
          }
        });

        return () => {
          unsubscribe();
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
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

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
    setStatus('ended');
    const seconds = Math.floor((Date.now() - startTimeRef.current) / 1000);
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
    <div className="flex flex-col gap-3 h-full min-h-0">
      <RetroAlert tone="info">
        Voice mode is on. Calls aren&rsquo;t recorded — only the live
        transcript is persisted to your session history. Press{' '}
        <kbd className="px-1 border-2 border-black dark:border-retro-ink-dark">End call</kbd>{' '}
        when you&rsquo;re done.
      </RetroAlert>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark px-4 py-8 shadow-retro-2 dark:shadow-retro-dark-2">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider2 text-retro-ink-mute dark:text-retro-ink-mute-dark font-monoRetro mb-2">
            Speaking with
          </div>
          <div className="text-2xl font-display font-bold">{personaLabel}</div>
        </div>

        <div className="w-full max-w-xl space-y-3" aria-live="polite">
          {aiCaption && aiCaption.text && (
            <div className="border-2 border-black dark:border-retro-ink-dark bg-retro-paper dark:bg-retro-paper-dark p-3">
              <div className="text-[10px] uppercase tracking-wider2 font-monoRetro text-retro-ink-mute dark:text-retro-ink-mute-dark mb-1">
                {personaLabel}
              </div>
              <div className="text-sm leading-snug">{aiCaption.text}</div>
            </div>
          )}
          {userCaption && userCaption.text && (
            <div className="border-2 border-black dark:border-retro-ink-dark bg-retro-accent/30 dark:bg-retro-accent-dark/30 p-3">
              <div className="text-[10px] uppercase tracking-wider2 font-monoRetro text-retro-ink-mute dark:text-retro-ink-mute-dark mb-1">
                You {userCaption.is_final ? '' : '(transcribing…)'}
              </div>
              <div className="text-sm leading-snug">{userCaption.text}</div>
            </div>
          )}
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
    return err.message;
  }
  if (err instanceof Error && err.message.toLowerCase().includes('permission')) {
    return 'Microphone permission was denied. Allow microphone access in your browser to use voice mode.';
  }
  if (err instanceof Error) return err.message;
  return 'Failed to start the voice call.';
}
