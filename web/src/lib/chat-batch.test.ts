import { describe, expect, it } from 'vitest';

import { dropPersistedPrefix } from '@/lib/chat-batch';
import type { Message } from '@/lib/types';

let seq = 0;
function msg(role: 'human' | 'ai', content: string): Message {
  seq += 1;
  return {
    id: `m${seq}`,
    role,
    content,
    order_index: seq,
    source: 'text',
    typing_delay_ms: null,
    created_at: new Date(seq * 1000).toISOString(),
  };
}

describe('dropPersistedPrefix', () => {
  it('returns the batch unchanged when the transcript is empty', () => {
    expect(dropPersistedPrefix(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns the batch unchanged when the transcript has no human messages', () => {
    const transcript = [msg('ai', 'opener')];
    expect(dropPersistedPrefix(['a', 'b'], transcript)).toEqual(['a', 'b']);
  });

  it('never drops the last (just-typed) batch item, even on an exact match', () => {
    // Genuine repeat: the user sends "yes" again after a completed turn.
    const transcript = [msg('human', 'yes'), msg('ai', 'Great!')];
    expect(dropPersistedPrefix(['yes'], transcript)).toEqual(['yes']);
  });

  it('drops a single pending human the interrupted turn already persisted', () => {
    // Interrupt after the first AI bubble: M1 + AI1 are persisted; the
    // re-sent batch [M1, M2] must shrink to [M2].
    const transcript = [
      msg('ai', 'opener'),
      msg('human', 'M1'),
      msg('ai', 'AI1'),
    ];
    expect(dropPersistedPrefix(['M1', 'M2'], transcript)).toEqual(['M2']);
  });

  it('drops a multi-message prefix persisted by the interrupted turn', () => {
    const transcript = [
      msg('ai', 'opener'),
      msg('human', 'M1'),
      msg('human', 'M2'),
      msg('ai', 'AI1'),
    ];
    expect(dropPersistedPrefix(['M1', 'M2', 'M3'], transcript)).toEqual(['M3']);
  });

  it('keeps the whole batch when the turn aborted before anything persisted', () => {
    const transcript = [msg('ai', 'opener'), msg('human', 'old'), msg('ai', 'AI0')];
    expect(dropPersistedPrefix(['M1', 'M2'], transcript)).toEqual(['M1', 'M2']);
  });

  it('matches the batch prefix against the END of a longer human run', () => {
    // Two chained interrupts: M0 persisted in an earlier turn, then the
    // [M0, M1] turn persisted both; the newest batch is [M1, M2].
    const transcript = [
      msg('human', 'M0'),
      msg('human', 'M1'),
      msg('ai', 'AI1'),
    ];
    expect(dropPersistedPrefix(['M1', 'M2'], transcript)).toEqual(['M2']);
  });

  it('does not drop on content mismatch', () => {
    const transcript = [msg('human', 'M1'), msg('ai', 'AI1')];
    expect(dropPersistedPrefix(['different', 'M2'], transcript)).toEqual([
      'different',
      'M2',
    ]);
  });

  it('with protectLast=false, drops a fully persisted batch (call-end reconcile)', () => {
    const transcript = [msg('human', 'M1'), msg('ai', 'AI1')];
    expect(dropPersistedPrefix(['M1'], transcript, false)).toEqual([]);
  });

  it('with protectLast=false, keeps only the unpersisted tail', () => {
    const transcript = [msg('human', 'M1'), msg('ai', 'AI1')];
    expect(dropPersistedPrefix(['M1', 'M2'], transcript, false)).toEqual(['M2']);
  });
});
