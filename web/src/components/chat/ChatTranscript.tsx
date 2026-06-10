'use client';

import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';

import type { Message } from '@/lib/types';
import { MarkdownMessage } from '@/components/ui/MarkdownMessage';
import { PersonaAvatar } from '@/components/ui/PersonaAvatar';

import { TypingIndicator } from './TypingIndicator';

/**
 * Minimal persona reference used to render the avatar gutter on AI bubbles.
 * The session page derives this from the `SimulationDetail` it has already
 * fetched; missing fields silently fall back to initials.
 */
export interface ChatPersona {
  name: string;
  avatarUrl?: string | null;
  slug?: string | null;
  role?: string | null;
}

interface ChatTranscriptProps {
  messages: Message[];
  /** Optimistic user message (shown immediately after send, before `done`). */
  pendingHuman?: string | null;
  /**
   * AI messages already delivered within the current burst but not yet
   * persisted via `done`. Each renders as its own "pending" bubble so the
   * typing indicator can appear between them while the persona "types"
   * the next follow-up.
   */
  burstedAssistant?: string[];
  /** Currently-streaming AI message content (the in-flight bubble). */
  pendingAssistant?: string | null;
  /**
   * True while waiting on the agent — either before the first chunk of a
   * turn, or during the simulated pause between burst messages.
   */
  isWaiting?: boolean;
  /**
   * Persona metadata used to render avatars next to AI bubbles. When
   * undefined the transcript falls back to the original avatar-less layout
   * (e.g. while the simulation detail is still loading).
   */
  persona?: ChatPersona;
}

export const ChatTranscript: React.FC<ChatTranscriptProps> = ({
  messages,
  pendingHuman,
  burstedAssistant,
  pendingAssistant,
  isWaiting,
  persona,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Always snap to the bottom on any content change — new human message,
  // new AI chunk, typing indicator toggling, etc. We scroll the inner
  // container only and never the window.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pendingHuman, burstedAssistant, pendingAssistant, isWaiting]);

  const empty =
    messages.length === 0 &&
    !pendingHuman &&
    !pendingAssistant &&
    !isWaiting &&
    (burstedAssistant?.length ?? 0) === 0;

  // Build a flat ordered list with metadata so we can decide which AI bubbles
  // should show the avatar (first AI in a streak) vs. align to the same
  // gutter without one (subsequent bursts/follow-ups). Persisted messages
  // come first, then the in-flight pendingHuman, then the current AI burst.
  const items: BubbleItem[] = [];
  for (const m of messages) {
    // Older messages persisted before voice tagging have no `source`;
    // treat them as text so they render outside any voice-call block.
    items.push({ key: m.id, role: m.role, content: m.content, source: m.source ?? 'text' });
  }
  // Pending bubbles only ever appear in live text chat (voice mode swaps the
  // composer/transcript for the call surface), so they are always text.
  if (pendingHuman) {
    items.push({
      key: 'pending-human',
      role: 'human',
      content: pendingHuman,
      source: 'text',
      pending: true,
    });
  }
  burstedAssistant?.forEach((content, i) => {
    items.push({ key: `burst-${i}`, role: 'ai', content, source: 'text', pending: true });
  });
  if (pendingAssistant) {
    items.push({
      key: 'pending-ai',
      role: 'ai',
      content: pendingAssistant,
      source: 'text',
      pending: true,
    });
  }

  // Interleave the bubbles with "voice call" dividers: a run of one or more
  // consecutive voice-sourced messages is wrapped with a START block before
  // it and an END block after it. Multiple calls in one session naturally
  // produce multiple paired blocks; a call whose messages are the tail of
  // the transcript gets a trailing END block.
  const rendered: React.ReactNode[] = [];
  let inVoiceBlock = false;
  items.forEach((item, idx) => {
    const prev = items[idx - 1];
    const sourceChanged = (prev?.source ?? item.source) !== item.source;
    if (item.source === 'voice' && !inVoiceBlock) {
      rendered.push(<CallDivider key={`call-start-${item.key}`} variant="start" />);
      inVoiceBlock = true;
    } else if (item.source !== 'voice' && inVoiceBlock) {
      rendered.push(<CallDivider key={`call-end-${item.key}`} variant="end" />);
      inVoiceBlock = false;
    }
    // Avatar on the *first* AI bubble of a consecutive AI streak, and again
    // whenever a voice-call divider breaks the streak — so the persona is
    // re-identified at the top of each call segment.
    const showAvatar = item.role === 'ai' && (prev?.role !== 'ai' || sourceChanged);
    rendered.push(
      <Bubble
        key={item.key}
        role={item.role}
        content={item.content}
        pending={item.pending}
        persona={persona}
        showAvatar={showAvatar}
      />,
    );
  });
  if (inVoiceBlock) {
    rendered.push(<CallDivider key="call-end-final" variant="end" />);
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-2"
    >
      {empty && (
        <p className="text-sm text-secondary-600 dark:text-secondary-400">
          No messages yet. Send the first one below.
        </p>
      )}
      {rendered}
      {!pendingAssistant && isWaiting && (
        <TypingIndicator
          persona={persona}
          // Only label on a fresh AI streak (start of a turn). Suppressed
          // during the typing pause between burst follow-ups, where the
          // last item is already an AI bubble.
          showLabel={items[items.length - 1]?.role !== 'ai'}
        />
      )}
    </div>
  );
};

interface BubbleItem {
  key: string;
  role: 'human' | 'ai';
  content: string;
  /** Origin of the message — drives the voice-call divider grouping. */
  source: 'text' | 'voice';
  pending?: boolean;
}

interface BubbleProps {
  role: 'human' | 'ai';
  content: string;
  pending?: boolean;
  persona?: ChatPersona;
  /** Render the persona avatar in the gutter (AI bubbles only). */
  showAvatar?: boolean;
}

const Bubble: React.FC<BubbleProps> = ({
  role,
  content,
  pending,
  persona,
  showAvatar,
}) => {
  const isHuman = role === 'human';

  if (isHuman) {
    return (
      <div className="flex justify-end">
        <div
          className={clsx(
            'max-w-[85%] px-4 py-3 border-2 shadow-retro-2 dark:shadow-retro-dark-2',
            'bg-primary-100 dark:bg-primary-900 border-black dark:border-retro-ink-dark',
            pending && 'opacity-80',
          )}
        >
          <MarkdownMessage content={content} />
        </div>
      </div>
    );
  }

  // AI bubble: avatar gutter on the left so multi-line content wraps under
  // the bubble (not under the avatar). When `showAvatar` is false we keep
  // the same gutter width with a transparent spacer so consecutive bursts
  // line up cleanly. The "Name · Title" label sits above the bubble in the
  // same column and only renders on the first AI bubble of a streak (paired
  // with the avatar) — repeating it on every burst follow-up would be noisy.
  const showLabel = Boolean(persona && showAvatar);
  return (
    <div className="flex items-start gap-2 justify-start">
      {persona && showAvatar ? (
        <PersonaAvatar
          name={persona.name}
          avatarUrl={persona.avatarUrl}
          slug={persona.slug}
          roleHint={persona.role}
          size={36}
          previewOnHover
        />
      ) : (
        <span className="h-9 w-9 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 max-w-[85%]">
        {showLabel && (
          <PersonaLabel name={persona!.name} role={persona!.role} />
        )}
        <div
          className={clsx(
            'px-4 py-3 border-2 shadow-retro-2 dark:shadow-retro-dark-2',
            'bg-white dark:bg-retro-surface-dark border-black dark:border-retro-ink-dark',
            pending && 'opacity-80',
          )}
        >
          <MarkdownMessage content={content} />
        </div>
      </div>
    </div>
  );
};

/**
 * Compact "Name · Title" header rendered above the first bubble of an AI
 * streak. Mirrors familiar chat UIs (Slack, iMessage groups) so the user
 * has immediate context for who's talking and in what role.
 */
const PersonaLabel: React.FC<{ name: string; role?: string | null }> = ({
  name,
  role,
}) => (
  <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-tight">
    <span className="font-semibold text-retro-ink dark:text-retro-ink-dark">
      {name}
    </span>
    {role && (
      <span className="text-secondary-600 dark:text-secondary-400">
        {role}
      </span>
    )}
  </div>
);

/**
 * Full-width separator that brackets a run of voice-call messages so the user
 * can tell at a glance which part of the transcript was spoken vs. typed.
 * Rendered once when the transcript transitions text→voice (`start`) and once
 * when it transitions back voice→text or the call's messages end the log
 * (`end`).
 */
const CallDivider: React.FC<{ variant: 'start' | 'end' }> = ({ variant }) => {
  const label = variant === 'start' ? 'Voice call started' : 'Voice call ended';
  return (
    <div
      className="flex items-center gap-3 py-1 text-secondary-600 dark:text-secondary-400"
      role="separator"
      aria-label={label}
    >
      <span className="h-px flex-1 bg-black/30 dark:bg-retro-ink-dark/40" aria-hidden />
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
        <PhoneGlyph variant={variant} />
        {label}
      </span>
      <span className="h-px flex-1 bg-black/30 dark:bg-retro-ink-dark/40" aria-hidden />
    </div>
  );
};

const PhoneGlyph: React.FC<{ variant: 'start' | 'end' }> = ({ variant }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={clsx(variant === 'end' && 'opacity-70')}
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    {variant === 'end' && <line x1="2" y1="2" x2="22" y2="22" />}
  </svg>
);
