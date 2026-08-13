import { afterEach, describe, expect, it, vi } from 'vitest';

import { readSse } from './sse';
import type { StreamEvent } from './types';

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Installs a fetch mock that resolves with a controllable streaming body.
 * Mirrors real fetch behaviour: aborting the request signal errors the
 * body, so a pending `reader.read()` rejects with an AbortError.
 */
function installStreamingFetch() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => {
      controller.error(
        new DOMException('The user aborted a request.', 'AbortError'),
      );
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    fail: (err: unknown) => controller.error(err),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readSse', () => {
  it('yields parsed events and completes when the stream closes', async () => {
    const { push, close } = installStreamingFetch();
    const gen = readSse('/x', {});

    push(sseFrame('message', { content: 'one' }));
    push(sseFrame('done', {}));
    close();

    const seen: StreamEvent[] = [];
    for await (const event of gen) seen.push(event);
    expect(seen).toEqual([
      { type: 'message', data: { content: 'one' } },
      { type: 'done', data: {} },
    ]);
  });

  it('propagates a mid-stream network failure to the consumer', async () => {
    const { push, fail } = installStreamingFetch();
    const gen = readSse('/x', {});

    push(sseFrame('message', { content: 'one' }));
    const first = await gen.next();
    expect(first.done).toBe(false);

    fail(new Error('network down'));
    await expect(gen.next()).rejects.toThrow('network down');
  });

  it('rejects the pending read with AbortError when aborted while waiting', async () => {
    installStreamingFetch();
    const abort = new AbortController();
    const gen = readSse('/x', { signal: abort.signal });

    const pending = gen.next();
    // Let the generator get through fetch + setup into the event wait.
    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not leak an unhandled rejection when an aborted stream is abandoned', async () => {
    // Regression: sending a message mid-burst aborts the in-flight fetch and
    // `runStream` abandons the generator without draining it. The pump's
    // AbortError must not surface as an unhandled promise rejection.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { push } = installStreamingFetch();
      const abort = new AbortController();
      const gen = readSse('/x', { signal: abort.signal });

      push(sseFrame('message', { content: 'one' }));
      const first = await gen.next();
      expect(first.done).toBe(false);

      abort.abort();
      await gen.return(undefined);

      // Give any orphaned rejection a chance to fire.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
