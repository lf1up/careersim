/**
 * Browser-side voice mode helpers.
 *
 * Thin layer over `livekit-client` plus the kill-switch /
 * configuration handling. Imported by the voice components only — the
 * heavy `livekit-client` wheel is deferred behind a dynamic import in
 * {@link createVoiceConnection} so the rest of the app's bundle stays
 * unaffected when voice is disabled.
 */

import type { VoiceCaption, VoiceControlEvent } from './types';

const CAPTION_TOPIC = 'voice-captions';
const CONTROL_TOPIC = 'voice-control';

export function isVoiceEnabledClientSide(): boolean {
  // Both server- and client-side calls hit the same flag — `process.env`
  // is replaced at build time by Next, so this is a pure boolean.
  const v = process.env.NEXT_PUBLIC_VOICE_ENABLED;
  return v !== 'false' && v !== '0' && v !== undefined;
}

export interface VoiceConnection {
  /** LiveKit Room instance — exposed for advanced UI (audio meters, mute toggle). */
  room: import('livekit-client').Room;
  /** Disconnect, stop publishing, and clean up. Safe to call multiple times. */
  disconnect: () => Promise<void>;
  /**
   * Subscribe to caption frames published by the agent-voice worker.
   * Returns an unsubscribe function.
   */
  onCaption: (cb: (caption: VoiceCaption) => void) => () => void;
  /**
   * Subscribe to control events (quota warning / exhaustion) published
   * by the agent-voice worker. Returns an unsubscribe function.
   */
  onControl: (cb: (event: VoiceControlEvent) => void) => () => void;
}

export interface CreateVoiceConnectionArgs {
  url: string;
  token: string;
  /**
   * Stable participant identity — matches the LiveKit token's
   * `identity`. Useful for the UI to differentiate user vs. AI when
   * subscribing to remote tracks.
   */
  expectedAgentParticipantPrefix?: string;
}

/**
 * Connect to a LiveKit room, publish the user's microphone, and
 * subscribe to the AI agent's audio + caption data channel.
 *
 * Lazy-imports `livekit-client` so the rest of the app doesn't pay
 * the bundle cost when voice is disabled.
 */
export async function createVoiceConnection(
  args: CreateVoiceConnectionArgs,
): Promise<VoiceConnection> {
  const lk = await import('livekit-client');
  const { Room, Track } = lk;

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      // Standard mic capture — LiveKit handles rate negotiation with
      // the SFU. Echo cancellation + noise suppression are the
      // browser defaults; auto-gain reduces the dynamic range a bit
      // but smooths Whisper's accuracy on quiet voices.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  await room.connect(args.url, args.token, { autoSubscribe: true });
  await room.localParticipant.setMicrophoneEnabled(true);

  const captionListeners = new Set<(caption: VoiceCaption) => void>();
  const controlListeners = new Set<(event: VoiceControlEvent) => void>();

  room.on(lk.RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    if (topic !== CAPTION_TOPIC && topic !== CONTROL_TOPIC) return;
    try {
      const text = new TextDecoder().decode(payload);
      const parsed = JSON.parse(text);
      if (topic === CONTROL_TOPIC) {
        for (const cb of controlListeners) cb(parsed as VoiceControlEvent);
      } else {
        for (const cb of captionListeners) cb(parsed as VoiceCaption);
      }
    } catch {
      // Drop malformed frames silently — captions/control are best-effort UX.
    }
  });

  // Bind the AI's audio track to a hidden <audio> element on first
  // subscription so playback starts automatically. We use `Track.Kind.Audio`
  // rather than constructor brand checks so future minor-version
  // changes don't break our switch.
  room.on(lk.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== Track.Kind.Audio) return;
    const audioEl = track.attach();
    audioEl.style.display = 'none';
    audioEl.setAttribute('data-livekit-voice', 'agent');
    document.body.appendChild(audioEl);
  });
  room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
  });

  let disconnected = false;
  const disconnect = async () => {
    if (disconnected) return;
    disconnected = true;
    try {
      await room.disconnect();
    } catch {
      // Best-effort — the SFU may already have closed the stream.
    }
  };

  const onCaption = (cb: (caption: VoiceCaption) => void) => {
    captionListeners.add(cb);
    return () => captionListeners.delete(cb);
  };

  const onControl = (cb: (event: VoiceControlEvent) => void) => {
    controlListeners.add(cb);
    return () => controlListeners.delete(cb);
  };

  return { room, disconnect, onCaption, onControl };
}
