import type { Message } from '@/lib/types';

/**
 * Drop the leading batch items the server has already persisted. After an
 * interrupt, the client re-sends its pending human messages, but the
 * aborted turn may already have persisted a prefix of them (humans land
 * with the first streamed AI message). We match that prefix against the
 * most recent run of consecutive human messages in the authoritative
 * transcript.
 *
 * With `protectLast` (the default) the last batch item — the message the
 * user just typed — is never dropped, so a genuine repeat of an older
 * message is never eaten.
 */
export function dropPersistedPrefix(
  batch: string[],
  messages: Message[],
  protectLast = true,
): string[] {
  const prefix = protectLast ? batch.slice(0, -1) : batch.slice();
  if (prefix.length === 0) return batch;
  let runEnd = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'human') {
      runEnd = i;
      break;
    }
  }
  if (runEnd === -1) return batch;
  let runStart = runEnd;
  while (runStart - 1 >= 0 && messages[runStart - 1].role === 'human') {
    runStart--;
  }
  const run = messages.slice(runStart, runEnd + 1).map((m) => m.content);
  const maxDrop = Math.min(run.length, prefix.length);
  for (let n = maxDrop; n > 0; n--) {
    const runSuffix = run.slice(run.length - n);
    if (runSuffix.every((content, i) => content === prefix[i])) {
      return batch.slice(n);
    }
  }
  return batch;
}
