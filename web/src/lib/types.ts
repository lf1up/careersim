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
  persona_slug?: string | null;
  avatar_url?: string | null;
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
  persona_slug?: string | null;
  avatar_url?: string | null;
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
  avatar_url?: string | null;
}

export type MessageRole = 'human' | 'ai';

/** Where a message originated: web text chat vs a LiveKit voice call. */
export type MessageSource = 'text' | 'voice';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  order_index: number;
  /**
   * Origin of the message. Older sessions persisted before voice tagging
   * may omit it over the wire, so treat a missing value as `'text'`.
   */
  source: MessageSource;
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
  goal_progress: GoalProgress[];
}

// ---- Session debrief report -----------------------------------------

export type DebriefSkillKey =
  | 'clarity'
  | 'confidence'
  | 'problem_solving'
  | 'emotional_intelligence'
  | 'goal_outcome';

export interface DebriefSkill {
  key: DebriefSkillKey | string;
  /** 0-100 */
  score: number;
  rationale: string;
}

export interface DebriefTonePhase {
  phase: string;
  tone: string;
  note: string;
}

export interface DebriefKeyMoment {
  /** Matches `Message.order_index` in the session transcript. */
  message_index: number;
  role: MessageRole | string;
  label: string;
  note: string;
}

export interface DebriefGoalOutcome {
  score: number;
  total: number;
  required: number;
  achieved_required: number;
  achieved_total: number;
}

export interface DebriefStats {
  message_count: number;
  user_message_count: number;
  ai_message_count: number;
  user_word_count: number;
  ai_word_count: number;
  duration_seconds?: number | null;
}

/** Aggregate voice signals mirrored from the agent's `VoiceSignals`. */
export interface DebriefVoiceSignals {
  user_avg_wpm?: number;
  ai_avg_wpm?: number;
  user_filler_count?: number;
  user_filler_density_per_100w?: number;
  user_avg_response_latency_sec?: number;
  user_max_response_latency_sec?: number;
  longest_silence_sec?: number;
  user_interrupt_count?: number;
  ai_interrupt_count?: number;
  user_speaking_time_sec?: number;
  ai_speaking_time_sec?: number;
  [key: string]: unknown;
}

export interface DebriefReport {
  version: number;
  generated_at: string;
  overall_score: number;
  skills: DebriefSkill[];
  goal_outcome: DebriefGoalOutcome | null;
  stats: DebriefStats;
  emotional_tone: {
    overall: string;
    journey: DebriefTonePhase[];
  };
  summary: string;
  strengths: string[];
  improvement_areas: string[];
  advice: string[];
  key_moments: DebriefKeyMoment[];
  voice: DebriefVoiceSignals | null;
}

export interface SessionReportResponse {
  session_id: string;
  simulation_slug: string;
  message_count: number;
  /** True when served from cache without a fresh agent call. */
  cached: boolean;
  report: DebriefReport;
}

// ---- Aggregate analytics ---------------------------------------------

export interface SkillAverage {
  key: string;
  average: number;
  count: number;
}

export interface ScoreTrendPoint {
  session_id: string;
  simulation_slug: string;
  created_at: string;
  overall_score: number;
  skills: Record<string, number>;
}

export interface PhraseCount {
  text: string;
  count: number;
}

export interface ToneCount {
  tone: string;
  count: number;
}

export interface SimulationBreakdown {
  simulation_slug: string;
  sessions: number;
  completed_sessions: number;
  best_overall_score: number | null;
  best_goals_achieved: number;
  goals_required: number;
  last_played_at: string;
}

export interface AnalyticsOverview {
  totals: {
    sessions: number;
    simulations_tried: number;
    messages: number;
    user_messages: number;
    practice_seconds: number;
    voice_seconds: number;
  };
  goals: {
    achieved: number;
    total: number;
    completed_sessions: number;
    completable_sessions: number;
    /** 0-1 fraction, null when no session tracks goals yet. */
    completion_rate: number | null;
  };
  reports: {
    analyzed_sessions: number;
    total_sessions: number;
    average_overall: number | null;
    skill_averages: SkillAverage[];
    trend: ScoreTrendPoint[];
    top_strengths: PhraseCount[];
    top_improvement_areas: PhraseCount[];
    tones: ToneCount[];
  };
  per_simulation: SimulationBreakdown[];
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
  /**
   * `code` is a machine-readable error tag; `TURN_CONFLICT` means a
   * concurrent turn committed first and the send should be retried
   * against fresh state.
   */
  data: { message: string; code?: string };
};

export type StreamEvent = StreamMessageEvent | StreamDoneEvent | StreamErrorEvent;

// ---- Voice mode -----------------------------------------------------

export interface VoiceStartResponse {
  token: string;
  livekit_url: string;
  room: string;
  expires_at: string;
  /** Remaining seconds in the user's daily voice budget; null = unlimited. */
  quota_remaining_seconds: number | null;
}

export interface VoiceEndResponse {
  /** Seconds actually persisted to `voice_minute_usage`. */
  seconds_recorded: number;
  quota_remaining_seconds: number | null;
}

/**
 * Caption frame published by the agent-voice worker on the LiveKit
 * data channel. Mirrors `Caption` in
 * `agent/src/careersim_agent/voice/transcripts.py`.
 */
export interface VoiceCaption {
  role: 'user' | 'ai';
  text: string;
  is_final: boolean;
  confidence?: number | null;
}

/**
 * Out-of-band control event published by the agent-voice worker on the
 * `voice-control` data-channel topic. Used to warn about and enforce
 * the daily voice budget (`cap_seconds` lets the UI render the actual
 * configured limit instead of hardcoding a number) and to group live
 * captions into turns: `turn_committed` means the current turn was
 * persisted (the next user utterance starts a fresh caption group);
 * `turn_superseded` means the in-flight reply was abandoned because the
 * user kept talking (its already-shown bubbles will never persist and
 * should be dropped). `tts_error` means speech synthesis failed for a
 * reply bubble — the conversation continues (captions + transcript stay
 * correct) but the persona's audio is unavailable.
 */
export interface VoiceControlEvent {
  type:
    | 'quota_warning'
    | 'quota_exhausted'
    | 'turn_committed'
    | 'turn_superseded'
    | 'tts_error';
  remaining_seconds?: number | null;
  cap_seconds?: number | null;
}
