'use client';

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import clsx from 'clsx';

import type { Message } from '@/lib/types';
import { MarkdownMessage } from '@/components/ui/MarkdownMessage';

import { TypingIndicator } from './TypingIndicator';

interface ChatTranscriptProps {
  messages: Message[];
  /** Optimistic user message (shown immediately after send, before `done`). */
  pendingHuman?: string | null;
  /** Streaming AI chunks accumulated so far. */
  pendingAssistant?: string | null;
  /** True between "message sent" and "first AI chunk arrived". */
  isWaiting?: boolean;
}

// Distance from the bottom (in px) within which we consider the user to be
// "pinned to the bottom" and safe to auto-scroll on new content.
const STICKY_THRESHOLD_PX = 64;

export const ChatTranscript: React.FC<ChatTranscriptProps> = ({
  messages,
  pendingHuman,
  pendingAssistant,
  isWaiting,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track whether the user was at (or near) the bottom BEFORE the next render.
  // We snapshot this in a layout effect so we can decide what to do after DOM
  // updates without causing our own autoscroll to count as a user scroll.
  const stickToBottomRef = useRef(true);

  // Snapshot sticky state BEFORE new content is painted.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= STICKY_THRESHOLD_PX;
  });

  // After content updates, scroll the inner container only — never the window
  // — and only when the user was already at the bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pendingHuman, pendingAssistant, isWaiting]);

  // Detect manual user scrolls so we can drop the sticky flag (and pick it
  // back up if they scroll to the bottom again).
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= STICKY_THRESHOLD_PX;
  };

  const empty =
    messages.length === 0 && !pendingHuman && !pendingAssistant && !isWaiting;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="space-y-3 overflow-y-auto overscroll-contain pr-2"
      style={{ maxHeight: 'calc(100vh - 320px)' }}
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
