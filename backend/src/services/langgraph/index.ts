/**
 * LangGraph Conversation System
 * 
 * Main exports for the LangGraph-based conversation agent
 */

// Core graph
export {
  buildConversationGraph,
  compileConversationGraph,
  getConversationGraph,
  resetConversationGraph,
  invokeConversationGraph,
  streamConversationGraph,
  NODE_NAMES,
} from './graph';

// State management
export type {
  ConversationGraphState,
  ProactiveTrigger,
  GoalProgressItem,
  ConversationInput,
  ConversationOutput,
} from './state';

export {
  sessionToGraphState,
  extractStateMetrics,
} from './state';

// Checkpointing
export {
  DatabaseCheckpointSaver,
  getCheckpointer,
  resetCheckpointer,
} from './checkpointer';

// Prompts
export {
  PERSONA_SYSTEM_PROMPT,
  PROACTIVE_START_PROMPT,
  PROACTIVE_INACTIVITY_PROMPT,
  PROACTIVE_FOLLOWUP_PROMPT,
  PROACTIVE_BACKCHANNEL_PROMPT,
  buildPersonaSystemPrompt,
  buildProactiveStartPrompt,
  buildProactiveInactivityPrompt,
  buildProactiveFollowupPrompt,
  buildProactiveBackchannelPrompt,
  formatConversationStyle,
  formatRagContext,
} from './prompts';

// Tools
export {
  evaluationTools,
  analyzeUserBehaviorTool,
  analyzeAiIndicatorsTool,
  getGoalContextTool,
  getConversationWindowTool,
  executeUserBehaviorAnalysis,
  executeAiIndicatorsAnalysis,
} from './tools/evaluation_tools';

// Nodes (if needed for direct access or testing)
export {
  processUserInputNode,
  fetchRagContextNode,
  generateAiResponseNode,
  analyzeResponseNode,
} from './nodes/conversation';

export {
  checkProactiveTriggerNode,
  generateProactiveMessageNode,
} from './nodes/proactive';

export {
  evaluateGoalsNode,
} from './nodes/evaluation';

export {
  persistAndEmitNode,
  scheduleInactivityNode,
} from './nodes/persistence';

// Standalone server utilities (if needed for programmatic access)
export {
  initializeDatabase,
  listSimulations,
  createSession,
  getSessionById,
  listSessions,
  sessionToThreadConfig,
} from './standalone-utils';
