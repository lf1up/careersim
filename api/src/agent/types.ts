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

/**
 * Loose analysis envelope. Historically these were short string labels, but
 * `agent/src/careersim_agent/graph/nodes/evaluation.py` now emits richer
 * objects (e.g. `{ label, confidence, source }`). Callers should treat each
 * field as opaque JSON.
 */
export interface AgentAnalysis {
  user_sentiment?: unknown;
  user_emotion?: unknown;
  ai_sentiment?: unknown;
  ai_emotion?: unknown;
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
  description?: string | null;
  difficulty?: number | null;
  estimated_duration_minutes?: number | null;
  goal_count?: number | null;
  skills_to_learn?: string[];
  tags?: string[];
}

export interface AgentSimulationsResponse {
  simulations: AgentSimulation[];
}

export interface AgentSimulationGoal {
  goal_number: number;
  title: string;
  description: string;
  key_behaviors: string[];
  success_indicators: string[];
  is_optional: boolean;
}

export interface AgentSimulationSuccessCriteria {
  communication: string[];
  problem_solving: string[];
  emotional: string[];
}

export interface AgentSimulationDetail {
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
  success_criteria: AgentSimulationSuccessCriteria;
  conversation_goals: AgentSimulationGoal[];
}

/**
 * Public-safe persona summary. The agent intentionally strips
 * `personality`, `primaryGoal`, `hiddenMotivation`, and `conversationStyle`
 * from this response so internal roleplay config never reaches clients.
 */
export interface AgentPersona {
  slug: string;
  name: string;
  role: string;
  category: string;
  difficulty_level: number;
}

export interface AgentPersonasResponse {
  personas: AgentPersona[];
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
