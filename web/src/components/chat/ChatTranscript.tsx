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
    items.push({ key: m.id, role: m.role, content: m.content });
  }
  if (pendingHuman) {
    items.push({ key: 'pending-human', role: 'human', content: pendingHuman, pending: true });
  }
  burstedAssistant?.forEach((content, i) => {
    items.push({ key: `burst-${i}`, role: 'ai', content, pending: true });
  });
  if (pendingAssistant) {
    items.push({
      key: 'pending-ai',
      role: 'ai',
      content: pendingAssistant,
      pending: true,
    });
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
      {items.map((item, idx) => {
        const prev = items[idx - 1];
        // Avatar only on the *first* AI bubble in a consecutive AI streak;
        // follow-up burst messages keep the gutter alignment but stay
        // visually quiet.
        const showAvatar = item.role === 'ai' && prev?.role !== 'ai';
        return (
          <Bubble
            key={item.key}
            role={item.role}
            content={item.content}
            pending={item.pending}
            persona={persona}
            showAvatar={showAvatar}
          />
        );
      })}
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
