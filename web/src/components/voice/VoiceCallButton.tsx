'use client';

import React from 'react';
import { PhoneIcon } from '@heroicons/react/24/solid';

import { Button } from '@/components/ui/Button';

interface VoiceCallButtonProps {
  /** Visible only when voice mode is enabled at build time AND the persona supports voice. */
  available: boolean;
  isCalling: boolean;
  starting?: boolean;
  onStart: () => void;
}

/**
 * Header-level "Call" button on session pages.
 *
 * Renders nothing when voice is unavailable so the kill switch
 * (`NEXT_PUBLIC_VOICE_ENABLED=false`) hides the entry point cleanly
 * without leaving a disabled-looking button on the page. Once a call
 * is in progress, also renders nothing — the in-call surface
 * provides its own end-call control.
 *
 * Styled to stand out as the headline feature: the amber `secondary`
 * accent, a phone glyph, and a small pulsing "live" dot signal that a
 * real-time voice call is available — most users never expect that on a
 * chat page, so the button has to advertise itself.
 */
export function VoiceCallButton({
  available,
  isCalling,
  starting,
  onStart,
}: VoiceCallButtonProps) {
  if (!available || isCalling) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      isLoading={starting}
      onClick={onStart}
      className="gap-2"
      aria-label="Start a voice call with the persona"
    >
      {!starting && (
        // Pulsing dot reads as "live / available now". The ping ring is
        // purely decorative and collapses under reduced-motion.
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-green-600 opacity-75 animate-ping motion-reduce:hidden" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600 border border-black" />
        </span>
      )}
      <PhoneIcon className="h-4 w-4" aria-hidden="true" />
      Call
    </Button>
  );
}
