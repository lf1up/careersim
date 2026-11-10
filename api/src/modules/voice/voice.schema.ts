import { z } from 'zod';

/** Hangup identifies the exact call; duration is debited only by checkpoints. */
export const voiceEndSchema = z.object({
  call_id: z.uuid(),
  voice_analysis: z.record(z.string(), z.unknown()).optional(),
});
export type VoiceEndBody = z.infer<typeof voiceEndSchema>;
export const voiceStartResponseSchema = z.object({
  token: z.string(), livekit_url: z.string(), room: z.string(), call_id: z.uuid(),
  expires_at: z.string(), quota_remaining_seconds: z.number().int().nonnegative().nullable(),
});
export type VoiceStartResponse = z.infer<typeof voiceStartResponseSchema>;
export const voiceEndResponseSchema = z.object({
  seconds_recorded: z.number().int().nonnegative(),
  quota_remaining_seconds: z.number().int().nonnegative().nullable(),
});
export type VoiceEndResponse = z.infer<typeof voiceEndResponseSchema>;
export const stateForVoiceResponseSchema = z.record(z.string(), z.unknown());
export const voiceBudgetResponseSchema = z.object({
  remaining_seconds: z.number().int().nonnegative().nullable(),
  cap_seconds: z.number().int().nonnegative().nullable(),
  usage_date: z.string(), reset_at: z.iso.datetime(),
});
export type VoiceBudgetResponse = z.infer<typeof voiceBudgetResponseSchema>;
export const voiceCheckpointSchema = z.object({
  sequence: z.number().int().nonnegative().max(2147483647),
  cumulative_seconds: z.number().int().nonnegative().max(2147483647),
  ended: z.boolean(),
});
export const voiceCheckpointResponseSchema = voiceBudgetResponseSchema.extend({ continue_call: z.boolean() });
