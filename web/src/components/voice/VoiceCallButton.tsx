'use client';

import React from 'react';

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
      variant="outline"
      size="sm"
      isLoading={starting}
      onClick={onStart}
      // The microphone glyph leans on the system font; avoid an extra
      // icon dependency for a single-use surface. Sentence-cased so it
      // sits next to existing badges without shouting.
    >
      Call
    </Button>
  );
}
