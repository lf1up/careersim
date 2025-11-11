import { BaseMessage } from '@langchain/core/messages';

// Use type-only imports to avoid triggering TypeORM initialization
import type { Persona } from '@/entities/Persona';
import type { Simulation } from '@/entities/Simulation';
import type { SimulationSession } from '@/entities/SimulationSession';

/**
 * Proactive message trigger types
 */
export type ProactiveTrigger = 'followup' | 'inactivity' | 'backchannel' | 'start';

/**
 * Goal progress status for tracking conversation objectives
 */
export interface GoalProgressItem {
  goalNumber: number;
  isOptional: boolean;
  title: string;
  status: 'not_started' | 'in_progress' | 'achieved';
  confidence: number;
  evidence?: Array<{
    messageId: string;
    role: 'user' | 'ai';
    label: string;
    score: number;
  }>;
  startedAt?: string;
  achievedAt?: string;
}

/**
 * Main state schema for the conversation graph
 * This state is passed between nodes and persisted via checkpoints
 */
export interface ConversationGraphState {
  // Session identification
  sessionId: string;
  userId: string;
  
  // Conversation history in LangChain format
  messages: BaseMessage[];
  
  // Persona and simulation context
  persona: Persona;
  simulation: Simulation;
  
  // Goal tracking
  goalProgress: GoalProgressItem[];
  
  // Turn management
  turn: 'user' | 'ai';
  
  // Last messages for context
  lastUserMessage?: string;
  lastAiMessage?: string;
  
  // Proactive message handling
  proactiveTrigger?: ProactiveTrigger;
  shouldSendProactive: boolean;
  proactiveCount: number;
  maxProactiveMessages?: number;
  
  // RAG context
  ragContext?: string;
  
  // Evaluation flags
  needsEvaluation: boolean;
  evaluationComplete: boolean;
  
  // Analysis results (from Transformers microservice)
  lastEmotionAnalysis?: {
    emotion: string;
    confidence: number;
  };
  lastSentimentAnalysis?: {
    sentiment: 'positive' | 'neutral' | 'negative';
    confidence: number;
  };
  lastQualityScores?: {
    overall?: number;
    coherence?: number;
    relevance?: number;
    completeness?: number;
    personaAlignment?: number;
  };
  
  // Metadata for additional context
  metadata: {
    startedAt?: Date;
    sessionDuration?: number;
    messageCount?: number;
    aiInitiated?: boolean;
    lastAiMessageAt?: Date;
    lastUserMessageAt?: Date;
    inactivityNudgeAt?: Date;
    inactivityNudgeCount?: number;
    conversationStyle?: any;
    [key: string]: any;
  };
  
  // Error handling
  lastError?: string;
  retryCount?: number;
  
  // Checkpoint management
  checkpointId?: string;
  checkpointVersion?: number;
}

/**
 * Input schema for starting a conversation or sending a message
 */
export interface ConversationInput {
  sessionId: string;
  userId: string;
  userMessage?: string;
  proactiveTrigger?: ProactiveTrigger;
  metadata?: Record<string, any>;
}

/**
 * Output schema for graph execution results
 */
export interface ConversationOutput {
  sessionId: string;
  messages: BaseMessage[];
  lastAiMessage?: string;
  goalProgress: GoalProgressItem[];
  turn: 'user' | 'ai';
  metadata: {
    confidence?: number;
    processingTime?: number;
    emotionalTone?: string;
    sentiment?: 'positive' | 'neutral' | 'negative';
    [key: string]: any;
  };
}

/**
 * Helper to convert SimulationSession to initial graph state
 */
export function sessionToGraphState(
  session: SimulationSession,
  persona: Persona,
  simulation: Simulation,
  messages: BaseMessage[] = [],
): Partial<ConversationGraphState> {
  return {
    sessionId: session.id,
    userId: (session.user as any)?.id || '',
    messages,
    persona,
    simulation,
    goalProgress: session.goalProgress as GoalProgressItem[] || [],
    turn: session.turn || 'ai',
    shouldSendProactive: false,
    proactiveCount: 0,
    needsEvaluation: false,
    evaluationComplete: false,
    metadata: {
      startedAt: session.startedAt,
      sessionDuration: session.startedAt ? Date.now() - session.startedAt.getTime() : 0,
      messageCount: session.messageCount || 0,
      aiInitiated: session.aiInitiated || false,
      lastAiMessageAt: session.lastAiMessageAt,
      lastUserMessageAt: session.lastUserMessageAt,
      inactivityNudgeAt: session.inactivityNudgeAt,
      inactivityNudgeCount: session.inactivityNudgeCount || 0,
      conversationStyle: persona.conversationStyle,
    },
  };
}

/**
 * Helper to extract key metrics from state for logging/monitoring
 */
export function extractStateMetrics(state: ConversationGraphState) {
  return {
    sessionId: state.sessionId,
    messageCount: state.messages.length,
    turn: state.turn,
    goalsAchieved: state.goalProgress.filter(g => g.status === 'achieved').length,
    totalGoals: state.goalProgress.length,
    proactiveCount: state.proactiveCount,
    evaluationComplete: state.evaluationComplete,
    hasError: !!state.lastError,
    retryCount: state.retryCount || 0,
  };
}

