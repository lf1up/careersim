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

// ---------------------------------------------------------------------------
// Post-session debrief report (`POST /conversation/debrief`).
//
// The agent assembles this from one structured LLM call plus deterministic
// stats. Known fields are typed for the API's own aggregation (analytics
// overview) — everything else is passed through opaquely so the report can
// grow without an API redeploy.
// ---------------------------------------------------------------------------

export interface AgentDebriefSkill {
  /** clarity | confidence | problem_solving | emotional_intelligence | goal_outcome */
  key: string;
  /** 0-100 */
  score: number;
  rationale: string;
  [key: string]: unknown;
}

export interface AgentDebriefTonePhase {
  phase: string;
  tone: string;
  note: string;
  [key: string]: unknown;
}

export interface AgentDebriefKeyMoment {
  /** Index into the session transcript (matches `messages.order_index`). */
  message_index: number;
  role: AgentRole | string;
  label: string;
  note: string;
  [key: string]: unknown;
}

export interface AgentDebriefReport {
  version: number;
  generated_at: string;
  overall_score: number;
  skills: AgentDebriefSkill[];
  goal_outcome: {
    score: number;
    total: number;
    required: number;
    achieved_required: number;
    achieved_total: number;
    [key: string]: unknown;
  } | null;
  stats: {
    message_count: number;
    user_message_count: number;
    ai_message_count: number;
    user_word_count: number;
    ai_word_count: number;
    /** Injected API-side from message timestamps (agent state has none). */
    duration_seconds?: number | null;
    [key: string]: unknown;
  };
  emotional_tone: {
    overall: string;
    journey: AgentDebriefTonePhase[];
    [key: string]: unknown;
  };
  summary: string;
  strengths: string[];
  improvement_areas: string[];
  advice: string[];
  key_moments: AgentDebriefKeyMoment[];
  /** Passthrough of `state.analysis.voice` when the session had a call. */
  voice: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface AgentDebriefResponse {
  report: AgentDebriefReport;
}

export interface AgentSimulation {
  slug: string;
  title: string;
  persona_name: string;
  persona_slug?: string | null;
  avatar_url?: string | null;
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
  persona_slug?: string | null;
  avatar_url?: string | null;
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
  avatar_url?: string | null;
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
