'use client';

import React, { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { RetroTextArea } from '@/components/ui/RetroInput';

interface ChatComposerProps {
  /** Disables sending a new message (e.g. while a previous send is in flight). */
  sending?: boolean;
  onSend: (content: string) => Promise<void> | void;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  sending,
  onSend,
}) => {
  const [value, setValue] = useState('');

  const submit = async () => {
    const trimmed = value.trim();
    // Typing is always allowed; only submission is gated while a previous
    // message is still streaming. Enter-key presses during that window are
    // swallowed so the user's draft stays in the textarea for retry.
    if (!trimmed || sending) return;
    setValue('');
    try {
      await onSend(trimmed);
    } catch {
      // restore so the user can retry
      setValue(trimmed);
    }
  };

  return (
    <form
      className="flex items-end gap-2 sm:gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex-1">
        <RetroTextArea
          name="message"
          rows={2}
          placeholder="Type your message..."
          className="min-h-16 resize-y text-sm sm:min-h-24"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        className="sm:px-4 sm:py-2 sm:text-sm"
        disabled={sending || !value.trim()}
        isLoading={sending}
      >
        Send
      </Button>
    </form>
  );
};
