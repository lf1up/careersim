import { z } from 'zod';

export const createSessionSchema = z.object({
  simulation_slug: z.string().min(1).max(200),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(8000),
});

/**
 * Followup proactive triggers only — `inactivity` goes through
 * `POST /sessions/:id/nudge` and `start` is handled at session init.
 */
export const followupProactiveSchema = z.object({
  trigger_type: z.literal('followup'),
});

export const nudgeRequestSchema = z
  .object({
    /** Optional override of the server's `NUDGE_MIN_IDLE_SECONDS` floor. The
     *  server still enforces its own minimum. */
    min_idle_seconds: z.number().int().nonnegative().optional(),
  })
  .default({});

export const nudgeSkippedResponseSchema = z.object({
  nudged: z.literal(false),
  reason: z.enum(['no_human_activity', 'not_enough_idle', 'budget_exhausted']),
  idle_seconds: z.number().int(),
  nudge_count: z.number().int(),
});

export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['human', 'ai']),
  content: z.string(),
  order_index: z.number().int(),
  typing_delay_ms: z.number().int().nullable(),
  created_at: z.string(),
});

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  simulation_slug: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  message_count: z.number().int(),
});

export const goalProgressSchema = z.record(z.string(), z.unknown());
export const analysisSchema = z
  .object({
    user_sentiment: z.string().nullable().optional(),
    user_emotion: z.string().nullable().optional(),
    ai_sentiment: z.string().nullable().optional(),
    ai_emotion: z.string().nullable().optional(),
  })
  .loose();

export const sessionDetailSchema = z.object({
  id: z.uuid(),
  simulation_slug: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  messages: z.array(messageSchema),
  goal_progress: z.array(goalProgressSchema),
  analysis: analysisSchema,
});

export const sessionListResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
});

export const nudgeFiredResponseSchema = z.object({
  nudged: z.literal(true),
  session: sessionDetailSchema,
});

export const nudgeResponseSchema = z.union([
  nudgeFiredResponseSchema,
  nudgeSkippedResponseSchema,
]);

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type NudgeInput = z.infer<typeof nudgeRequestSchema>;
