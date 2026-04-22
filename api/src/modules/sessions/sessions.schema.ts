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

export const nudgeSkippedResponseSchema = z.object({
  nudged: z.literal(false),
  /**
   * - no_human_activity: session has never seen a human message yet and the
   *   persona-picked opening delay hasn't elapsed.
   * - not_enough_idle:   the persona's `inactivityNudgeDelaySec` window
   *   hasn't elapsed since the last activity (human reply OR previous nudge).
   * - budget_exhausted:  `persona.inactivityNudges.max` already fired in
   *   this silence window.
   * - nudges_disabled:   the persona did not declare inactivity-nudge config
   *   (or set `inactivityNudges.max` to 0). Clients can stop polling.
   * - agent_silent:      idle + budget both OK, but the agent graph returned
   *   without appending an AI message. Budget slot is refunded.
   */
  reason: z.enum([
    'no_human_activity',
    'not_enough_idle',
    'budget_exhausted',
    'nudges_disabled',
    'agent_silent',
  ]),
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

/**
 * Sentiment / emotion fields from the agent's evaluator are intentionally
 * opaque here: historically they were short strings, but the current
 * evaluation node in `agent/src/careersim_agent/graph/nodes/evaluation.py`
 * returns structured objects like `{ label, confidence, source }`. We keep
 * the known keys documented but accept any JSON value so the API never
 * blocks on a richer evaluator payload.
 */
const analysisValueSchema = z.unknown();

export const analysisSchema = z
  .object({
    user_sentiment: analysisValueSchema.optional(),
    user_emotion: analysisValueSchema.optional(),
    ai_sentiment: analysisValueSchema.optional(),
    ai_emotion: analysisValueSchema.optional(),
  })
  .loose();

/**
 * Persona-derived timing hints surfaced so clients can mirror the Gradio
 * dev UI's behaviour — pick a random inactivity delay in range, stop after
 * `max_inactivity_nudges`, and render typing indicators at the persona's
 * pace. Any missing field is returned as `null` when the underlying persona
 * config does not declare it.
 */
const rangeSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

export const sessionConfigSchema = z.object({
  // `true`/`false` — persona always/never opens. `"sometimes"` — persona
  // opens with ~50% probability (agent decides at init, but this field
  // still reports the raw behaviour so the UI can label it). `null` —
  // persona did not declare a value.
  starts_conversation: z
    .union([z.boolean(), z.literal('sometimes')])
    .nullable(),
  typing_speed_wpm: z.number().int().nonnegative().nullable(),
  inactivity_nudge_delay_sec: rangeSchema.nullable(),
  max_inactivity_nudges: z.number().int().nonnegative().nullable(),
  burstiness: rangeSchema.nullable(),
});

export const sessionDetailSchema = z.object({
  id: z.uuid(),
  simulation_slug: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  messages: z.array(messageSchema),
  goal_progress: z.array(goalProgressSchema),
  analysis: analysisSchema,
  session_config: sessionConfigSchema,
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
