'use client';

import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';

import type { Message } from '@/lib/types';
import { MarkdownMessage } from '@/components/ui/MarkdownMessage';

import { TypingIndicator } from './TypingIndicator';

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
}

export const ChatTranscript: React.FC<ChatTranscriptProps> = ({
  messages,
  pendingHuman,
  burstedAssistant,
  pendingAssistant,
  isWaiting,
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
      {messages.map((m) => (
        <Bubble key={m.id} role={m.role} content={m.content} />
      ))}
      {pendingHuman && <Bubble role="human" content={pendingHuman} pending />}
      {burstedAssistant?.map((content, i) => (
        <Bubble key={`burst-${i}`} role="ai" content={content} pending />
      ))}
      {pendingAssistant ? (
        <Bubble role="ai" content={pendingAssistant} pending />
      ) : isWaiting ? (
        <TypingIndicator />
      ) : null}
    </div>
  );
};

interface BubbleProps {
  role: 'human' | 'ai';
  content: string;
  pending?: boolean;
}

const Bubble: React.FC<BubbleProps> = ({ role, content, pending }) => {
  const isHuman = role === 'human';
  return (
    <div className={clsx('flex', isHuman ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[85%] px-4 py-3 border-2 shadow-retro-2 dark:shadow-retro-dark-2',
          isHuman
            ? 'bg-primary-100 dark:bg-primary-900 border-black dark:border-retro-ink-dark'
            : 'bg-white dark:bg-retro-surface-dark border-black dark:border-retro-ink-dark',
          pending && 'opacity-80',
        )}
      >
        <MarkdownMessage content={content} />
      </div>
    </div>
  );
};
