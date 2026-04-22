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
      className="flex items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex-1">
        <RetroTextArea
          name="message"
          rows={3}
          placeholder="Type your message..."
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
        disabled={sending || !value.trim()}
        isLoading={sending}
      >
        Send
      </Button>
    </form>
  );
};
