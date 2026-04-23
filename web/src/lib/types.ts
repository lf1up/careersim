// Types mirroring the Fastify API schemas in `api/src/modules/**`.
// Field names follow the wire format (snake_case) — no camelCase remapping layer.

export interface User {
  id: string;
  email: string;
  email_verified_at: string | null;
  has_password: boolean;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface PendingRegistration {
  pending: true;
  email: string;
}

export interface Simulation {
  slug: string;
  title: string;
  persona_name: string;
  description?: string | null;
  difficulty?: number | null;
  estimated_duration_minutes?: number | null;
  goal_count?: number | null;
  skills_to_learn?: string[];
  tags?: string[];
}

export interface SimulationGoal {
  goal_number: number;
  title: string;
  description: string;
  key_behaviors: string[];
  success_indicators: string[];
  is_optional: boolean;
}

export interface SimulationSuccessCriteria {
  communication: string[];
  problem_solving: string[];
  emotional: string[];
}

export interface SimulationDetail {
  slug: string;
  title: string;
  description: string;
  scenario: string;
  objectives: string[];
  persona_name: string;
  persona_role?: string | null;
  persona_category?: string | null;
  persona_difficulty_level?: number | null;
  difficulty?: number | null;
  estimated_duration_minutes?: number | null;
  skills_to_learn: string[];
  tags: string[];
  success_criteria: SimulationSuccessCriteria;
  conversation_goals: SimulationGoal[];
}

export interface Persona {
  slug: string;
  name: string;
  role: string;
  category: string;
  difficulty_level: number;
}

export type MessageRole = 'human' | 'ai';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  order_index: number;
  typing_delay_ms: number | null;
  created_at: string;
}

export interface Range {
  min: number;
  max: number;
}

/**
 * Tri-state for `startsConversation`, mirroring the API:
 * - `true` / `false` — persona always / never opens the conversation.
 * - `'sometimes'` — persona opens with ~50% probability (coin flipped
 *   by the agent at init time; this field still describes the persona's
 *   general behaviour).
 * - `null` — persona did not declare a value.
 */
export type StartsConversation = boolean | 'sometimes' | null;

export interface SessionConfig {
  starts_conversation: StartsConversation;
  typing_speed_wpm: number | null;
  inactivity_nudge_delay_sec: Range | null;
  max_inactivity_nudges: number | null;
  burstiness: Range | null;
}

export type Analysis = Record<string, unknown>;

export type GoalStatus = 'not_started' | 'in_progress' | 'achieved';

/**
 * Per-goal progress snapshot emitted by the agent's evaluation node. The
 * agent uses camelCase and keeps some fields optional (older sessions may
 * predate newer fields), so mirror that shape here.
 */
export interface GoalProgress {
  goalNumber: number;
  isOptional?: boolean;
  title?: string;
  status?: GoalStatus;
  confidence?: number;
  startedAt?: string | null;
  achievedAt?: string | null;
  evidence?: unknown[];
  [key: string]: unknown;
}

export interface SessionDetail {
  id: string;
  simulation_slug: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
  goal_progress: GoalProgress[];
  analysis: Analysis;
  session_config: SessionConfig;
}

export interface SessionSummary {
  id: string;
  simulation_slug: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export type NudgeSkipReason =
  | 'no_human_activity'
  | 'not_enough_idle'
  | 'budget_exhausted'
  | 'nudges_disabled'
  | 'agent_silent';

export interface NudgeSkipped {
  nudged: false;
  reason: NudgeSkipReason;
  idle_seconds: number;
  nudge_count: number;
}

export interface NudgeFired {
  nudged: true;
  session: SessionDetail;
}

export type NudgeResponse = NudgeSkipped | NudgeFired;

// Streaming event envelopes emitted by `lib/sse.ts`.
export type StreamMessageEvent = {
  type: 'message';
  data: {
    role: MessageRole;
    content: string;
    typing_delay_ms?: number | null;
    [key: string]: unknown;
  };
};

export type StreamDoneEvent = {
  type: 'done';
  data: { session: SessionDetail; state?: unknown };
};

export type StreamErrorEvent = {
  type: 'error';
  data: { message: string };
};

export type StreamEvent = StreamMessageEvent | StreamDoneEvent | StreamErrorEvent;
