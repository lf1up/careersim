'use client';

import React, { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { RetroTextArea } from '@/components/ui/RetroInput';

interface ChatComposerProps {
  /**
   * True while a reply is streaming. Sending stays ENABLED — a message
   * sent mid-reply abandons the in-flight turn and re-runs it with the
   * whole batch (see the session page's `handleSend`). The flag only
   * drives the button label so the user knows a reply is in progress.
   */
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
    if (!trimmed) return;
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
        disabled={!value.trim()}
      >
        {sending ? 'Send more' : 'Send'}
      </Button>
    </form>
  );
};
