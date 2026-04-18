/**
 * Wire-format types mirroring the Python agent's FastAPI contract.
 * Source of truth: `agent/src/careersim_agent/api/app.py`.
 *
 * The agent holds no session state; we treat its outputs as opaque JSON and
 * round-trip them through `state_snapshot` on every turn.
 */

export type AgentRole = 'human' | 'ai';

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export interface AgentGoalProgress {
  goalNumber?: number;
  status?: string;
  [key: string]: unknown;
}

export interface AgentAnalysis {
  user_sentiment?: string | null;
  user_emotion?: string | null;
  ai_sentiment?: string | null;
  ai_emotion?: string | null;
  [key: string]: unknown;
}

export interface AgentWireState {
  session_id?: string;
  simulation?: { slug?: string } & Record<string, unknown>;
  persona?: Record<string, unknown>;
  messages?: AgentMessage[];
  goal_progress?: AgentGoalProgress[];
  last_user_sentiment?: string | null;
  last_user_emotion?: string | null;
  last_ai_sentiment?: string | null;
  last_ai_emotion?: string | null;
  [key: string]: unknown;
}

export interface AgentConversationResponse {
  state: AgentWireState;
  messages: AgentMessage[];
  goal_progress: AgentGoalProgress[];
  analysis: AgentAnalysis;
}

export interface AgentSimulation {
  slug: string;
  title: string;
  persona_name: string;
}

export interface AgentSimulationsResponse {
  simulations: AgentSimulation[];
}

export type ProactiveTrigger = 'start' | 'inactivity' | 'followup';

/** SSE `event: message` payload emitted by the agent's streaming endpoints. */
export interface AgentStreamMessageEvent {
  content: string;
  node?: string;
  typing_delay_sec: number;
  message_index?: number;
  is_followup?: boolean;
  goal_progress?: AgentGoalProgress[];
  analysis?: AgentAnalysis;
}

/** SSE final `event: done` payload. */
export interface AgentStreamDoneEvent {
  state: AgentWireState;
  messages: AgentMessage[];
  goal_progress: AgentGoalProgress[];
}

export type AgentStreamEvent =
  | { type: 'message'; data: AgentStreamMessageEvent }
  | { type: 'done'; data: AgentStreamDoneEvent };
