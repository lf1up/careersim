import { createParser, type EventSourceMessage } from 'eventsource-parser';

import type { StreamEvent } from './types';

/**
 * SSE reader built on top of `fetch` + `ReadableStream`. We can't use the
 * native `EventSource` because the API requires a POST body + `Authorization:
 * Bearer` header, neither of which `EventSource` supports.
 */
export async function* readSse(
  url: string,
  init: RequestInit,
): AsyncGenerator<StreamEvent, void, void> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Accept: 'text/event-stream',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `SSE request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  if (!response.body) {
    throw new Error('SSE response has no body');
  }

  const queue: StreamEvent[] = [];
  let done = false;
  let resolveNext: (() => void) | null = null;

  const pushEvent = (msg: EventSourceMessage) => {
    if (!msg.event) return;
    let data: unknown;
    try {
      data = JSON.parse(msg.data);
    } catch {
      data = msg.data;
    }
    const type = msg.event as StreamEvent['type'];
    if (type === 'message' || type === 'done' || type === 'error') {
      queue.push({ type, data } as StreamEvent);
      resolveNext?.();
    }
  };

  const parser = createParser({ onEvent: pushEvent });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const pump = async () => {
    try {
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } finally {
      done = true;
      resolveNext?.();
    }
  };

  const pumping = pump();

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (done) break;
    await new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
    resolveNext = null;
  }

  await pumping;
}
