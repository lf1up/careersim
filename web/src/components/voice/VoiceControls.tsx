'use client';

import React from 'react';
import clsx from 'clsx';

import { Button } from '@/components/ui/Button';

interface VoiceControlsProps {
  isMuted: boolean;
  onToggleMute: () => void;
  onEndCall: () => void;
  /** Total seconds elapsed in the current call; surfaced as MM:SS. */
  elapsedSeconds: number;
  /**
   * Remaining seconds in the user's daily voice budget. `null` means
   * the deployment doesn't enforce a quota. Negative values are
   * clamped at 0 for display.
   */
  quotaRemainingSeconds: number | null;
  /** Connection status — drives the colour pip + assistive label. */
  status: 'connecting' | 'live' | 'reconnecting' | 'ended';
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const statusLabel: Record<VoiceControlsProps['status'], string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  ended: 'Call ended',
};

const statusPipClass: Record<VoiceControlsProps['status'], string> = {
  connecting: 'bg-yellow-400 animate-pulse',
  live: 'bg-green-500',
  reconnecting: 'bg-yellow-400 animate-pulse',
  ended: 'bg-gray-400',
};

export function VoiceControls({
  isMuted,
  onToggleMute,
  onEndCall,
  elapsedSeconds,
  quotaRemainingSeconds,
  status,
}: VoiceControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark px-3 py-2 shadow-retro-2 dark:shadow-retro-dark-2">
      <span
        className="flex items-center gap-2 text-xs uppercase tracking-wider2 font-monoRetro"
        aria-live="polite"
      >
        <span
          className={clsx('inline-block h-2 w-2 rounded-full', statusPipClass[status])}
          aria-hidden
        />
        {statusLabel[status]}
      </span>
      <span className="font-monoRetro text-sm tabular-nums" aria-label="Call duration">
        {formatClock(elapsedSeconds)}
      </span>
      {quotaRemainingSeconds !== null && (
        <span
          className="text-xs text-retro-ink-mute dark:text-retro-ink-mute-dark font-monoRetro"
          aria-label={`Voice budget remaining: ${formatClock(Math.max(0, quotaRemainingSeconds))}`}
          title="Daily voice budget remaining"
        >
          Budget: {formatClock(Math.max(0, quotaRemainingSeconds))}
        </span>
      )}
      <div className="ml-auto flex gap-2">
        <Button
          variant={isMuted ? 'secondary' : 'outline'}
          size="sm"
          onClick={onToggleMute}
          aria-pressed={isMuted}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={onEndCall}
          aria-label="End call"
        >
          End call
        </Button>
      </div>
    </div>
  );
}
