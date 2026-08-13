/**
 * In-memory registry of in-flight public chat turns, keyed by session id.
 *
 * Two jobs:
 *  1. A new turn for the same session aborts the registered one and awaits
 *     its cleanup before loading state, so two streaming turns can never
 *     race their version-guarded persists into a TURN_CONFLICT.
 *  2. The inactivity-nudge endpoint skips while a turn is in flight —
 *     otherwise the nudge's idempotency check (evaluated at POST time,
 *     before the turn resets `lastHumanMessageAt`) can dispatch a nudge
 *     whose commit collides with the turn mid-generation.
 *
 * Process-local by design: multi-replica deployments still have the DB
 * version guard (and the client's conflict retry) as the backstop.
 */
interface InFlightTurn {
  abort: AbortController;
  /** Resolves once the owning SSE proxy has fully cleaned up. */
  settled: Promise<void>;
}

const inFlightTurns = new Map<string, InFlightTurn>();

/** Bounded wait for a superseded turn's cleanup (see supersedeInFlightTurn). */
const SUPERSEDE_TIMEOUT_MS = 10_000;

export function getInFlightTurn(sessionId: string): InFlightTurn | undefined {
  return inFlightTurns.get(sessionId);
}

export function isTurnInFlight(sessionId: string): boolean {
  return inFlightTurns.has(sessionId);
}

/**
 * Register `abort`/`settled` as the session's active turn, superseding any
 * previous one: the previous turn is aborted and its cleanup awaited, so
 * the caller can load session state immediately after this returns.
 *
 * The wait is bounded: a wedged upstream must not block the new turn
 * forever. If cleanup outlives the timeout we proceed anyway — the DB
 * version guard remains the backstop and the stale turn's persists 409.
 */
export async function supersedeInFlightTurn(
  sessionId: string,
  turn: InFlightTurn,
): Promise<void> {
  const previous = inFlightTurns.get(sessionId);
  inFlightTurns.set(sessionId, turn);
  if (previous) {
    previous.abort.abort();
    await Promise.race([
      previous.settled,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SUPERSEDE_TIMEOUT_MS);
        // Don't hold the process (or a test runner) open for the timeout.
        timer.unref?.();
      }),
    ]);
  }
}

/** Clear the registration, but only if it still points at this turn. */
export function clearInFlightTurn(sessionId: string, abort: AbortController): void {
  if (inFlightTurns.get(sessionId)?.abort === abort) {
    inFlightTurns.delete(sessionId);
  }
}
