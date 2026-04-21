// Types mirroring the Fastify API schemas in `api/src/modules/**`.
// Field names follow the wire format (snake_case) — no camelCase remapping layer.

export interface User {
  id: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Simulation {
  slug: string;
  title: string;
  persona_name: string;
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

export interface SessionConfig {
  starts_conversation: boolean | null;
  typing_speed_wpm: number | null;
  inactivity_nudge_delay_sec: Range | null;
  max_inactivity_nudges: number | null;
  burstiness: Range | null;
}

export type Analysis = Record<string, unknown>;
export type GoalProgress = Record<string, unknown>;

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
