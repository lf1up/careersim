import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { VoiceControlEvent } from '@/lib/types';
const { start, end, connect, controls, disconnects, toastError } = vi.hoisted(() => ({ start: vi.fn(), end: vi.fn(), connect: vi.fn(), controls: [] as Array<(event: VoiceControlEvent) => void>, disconnects: [] as Array<() => void>, toastError: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), apiClient: { startVoiceCall: start, endVoiceCall: end } }));
vi.mock('@/lib/voice', () => ({ createVoiceConnection: connect }));
vi.mock('livekit-client', () => ({ RoomEvent: { Disconnected: 'disconnected' } }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: toastError }) }));
vi.mock('@/components/billing/QuotaNotice', () => ({ QuotaNotice: () => null }));
import { VoiceCallSurface } from './VoiceCallSurface';
const metadata = { call_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', token: 'token', livekit_url: 'wss://voice.example', room: 'room', expires_at: '2026-11-10T12:00:00Z', quota_remaining_seconds: 100 };
beforeEach(() => {
  vi.clearAllMocks(); controls.length = 0; disconnects.length = 0;
  HTMLElement.prototype.scrollTo = vi.fn();
  start.mockResolvedValue(metadata);
  end.mockResolvedValue({ seconds_recorded: 0, quota_remaining_seconds: 90 });
  connect.mockImplementation(async () => ({ disconnect: vi.fn(), onCaption: () => vi.fn(), onControl: (callback: (event: VoiceControlEvent) => void) => { controls.push(callback); return vi.fn(); }, room: { on: (_type: string, callback: () => void) => disconnects.push(callback), off: vi.fn(), localParticipant: { setMicrophoneEnabled: vi.fn() } } }));
});
it('ends the exact server call identity instead of submitting a client duration', async () => {
  const ended = vi.fn();
  render(<VoiceCallSurface sessionId="session-one" onCallEnded={ended} />);
  await screen.findByText('Live');
  fireEvent.click(screen.getByRole('button', { name: 'End call' }));
  await waitFor(() => expect(end).toHaveBeenCalledWith('session-one', metadata.call_id));
  expect(ended).toHaveBeenCalledOnce();
});
it('ignores quota controls for another call and accepts the active identity', async () => {
  render(<VoiceCallSurface sessionId="session-one" onCallEnded={vi.fn()} />);
  await screen.findByText('Live');
  await act(async () => controls[0]({ type: 'quota_exhausted', call_id: 'another-call', cap_seconds: 3600 }));
  expect(toastError).not.toHaveBeenCalled();
  await act(async () => controls[0]({ type: 'quota_exhausted', call_id: metadata.call_id, cap_seconds: 43200 }));
  expect(toastError).toHaveBeenCalledOnce();
});
it('cleans up a late reservation after unmount using its own identity', async () => {
  let resolve!: (value: typeof metadata) => void;
  start.mockReturnValue(new Promise(done => { resolve = done; }));
  const { unmount } = render(<VoiceCallSurface sessionId="session-one" onCallEnded={vi.fn()} />);
  unmount();
  await act(async () => { resolve(metadata); });
  await waitFor(() => expect(end).toHaveBeenCalledWith('session-one', metadata.call_id));
  expect(connect).not.toHaveBeenCalled();
});
it('does not let an old disconnect callback terminate a replacement session', async () => {
  const ended = vi.fn();
  const { rerender } = render(<VoiceCallSurface sessionId="session-one" onCallEnded={ended} />);
  await screen.findByText('Live');
  await waitFor(() => expect(disconnects).toHaveLength(1));
  const old = disconnects[0];
  start.mockResolvedValue({ ...metadata, call_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' });
  rerender(<VoiceCallSurface sessionId="session-two" onCallEnded={ended} />);
  await waitFor(() => expect(controls).toHaveLength(2));
  end.mockClear();
  await act(async () => old());
  expect(ended).not.toHaveBeenCalled();
  expect(end).not.toHaveBeenCalled();
});
it('ends promptly while connecting and releases the late reservation', async () => {
  let resolve!: (value: typeof metadata) => void;
  start.mockReturnValue(new Promise(done => { resolve = done; }));
  const ended = vi.fn();
  const { unmount } = render(<VoiceCallSurface sessionId="session-one" onCallEnded={ended} />);
  fireEvent.click(screen.getByRole('button', { name: 'End call' }));
  await waitFor(() => expect(ended).toHaveBeenCalledOnce());
  unmount();
  await act(async () => { resolve(metadata); });
  expect(end).toHaveBeenCalledWith('session-one', metadata.call_id);
});

it('releases the server reservation when connection setup fails', async () => {
  connect.mockRejectedValue(new Error('Microphone unavailable'));
  const ended = vi.fn();
  render(<VoiceCallSurface sessionId="session-one" onCallEnded={ended} />);
  await waitFor(() => expect(end).toHaveBeenCalledWith('session-one', metadata.call_id));
  expect(ended).toHaveBeenCalledWith(expect.any(Error));
});
