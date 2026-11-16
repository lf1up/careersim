import { apiClient } from '@/lib/api';
import { createVoiceConnection } from '@/lib/voice';

type EndResult = Awaited<ReturnType<typeof apiClient.endVoiceCall>>;
interface Reservation {
  start: ReturnType<typeof apiClient.startVoiceCall>;
  connection: ReturnType<typeof createVoiceConnection> | null;
  owners: number;
  close: Promise<EndResult> | null;
}

// A surface can unmount while its start response is still in flight. Share
// ownership across remounts, and finish any old hangup before starting again.
const reservations = new Map<string, Reservation>();

export function acquireVoiceReservation(sessionId: string) {
  const previous = reservations.get(sessionId);
  let reservation = previous;
  if (!reservation || reservation.close) {
    reservation = {
      start: previous?.close
        ? previous.close.then(() => apiClient.startVoiceCall(sessionId))
        : apiClient.startVoiceCall(sessionId),
      owners: 0,
      connection: null,
      close: null,
    };
    reservations.set(sessionId, reservation);
  }
  const owned = reservation;
  owned.owners++;
  let released: Promise<EndResult | undefined> | undefined;
  return {
    start: owned.start,
    connect() {
      owned.connection ??= owned.start.then(meta => createVoiceConnection({
        url: meta.livekit_url, token: meta.token,
      }));
      return owned.connection;
    },
    release() {
      if (released) return released;
      owned.owners--;
      // Effect replay can acquire the same reservation before cleanup starts.
      released = Promise.resolve().then(() => {
        if (owned.owners > 0) return;
        owned.close ??= owned.start.then(meta => {
          // A pending join also belongs to this reservation. If it resolves
          // after hangup, disconnect it without blocking the server close.
          void owned.connection?.then(connection => connection.disconnect()).catch(() => {});
          return apiClient.endVoiceCall(sessionId, meta.call_id);
        }).finally(() => {
          if (reservations.get(sessionId) === owned) reservations.delete(sessionId);
        });
        return owned.close;
      });
      return released;
    },
  };
}
