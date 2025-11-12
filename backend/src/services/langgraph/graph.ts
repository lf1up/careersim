import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { ConversationGraphState, ConversationInput } from './state';
import { getCheckpointer } from './checkpointer';

// Import node implementations (to be created)
import {
  processUserInputNode,
  fetchRagContextNode,
  generateAiResponseNode,
  analyzeResponseNode,
} from './nodes/conversation';

import {
  checkProactiveTriggerNode,
  generateProactiveMessageNode,
} from './nodes/proactive';

import { evaluateGoalsNode } from './nodes/evaluation';

import {
  persistAndEmitNode,
  scheduleInactivityNode,
} from './nodes/persistence';

/**
 * Define state annotation for LangGraph
 * This tells LangGraph how to handle state updates
 */
const StateAnnotation = Annotation.Root({
  // Session identification
  sessionId: Annotation<string>,
  userId: Annotation<string>,
  
  // Conversation history
  messages: Annotation<any[]>({
    reducer: (left, right) => (right ? right : left || []),
    default: () => [],
  }),
  
  // Persona and simulation
  persona: Annotation<any>,
  simulation: Annotation<any>,
  
  // Goal tracking
  goalProgress: Annotation<any[]>({
    reducer: (left, right) => (right ? right : left || []),
    default: () => [],
  }),
  
  // Turn management: Indicates whose turn it is to respond NEXT
  // 'user' = AI just spoke, waiting for user to respond
  // 'ai' = User just spoke, AI should respond
  turn: Annotation<'user' | 'ai'>({
    reducer: (left, right) => right ?? left,
    default: () => 'ai' as const,
  }),
  
  // Last messages
  lastUserMessage: Annotation<string | undefined>({
    reducer: (left, right) => right !== undefined ? right : left,
  }),
  lastAiMessage: Annotation<string | undefined>({
    reducer: (left, right) => right !== undefined ? right : left,
  }),
  
  // Input field (for initial invocation)
  userMessage: Annotation<string | undefined>({
    reducer: (left, right) => right, // Always use new value, even if undefined
  }),
  
  // Proactive handling
  proactiveTrigger: Annotation<string | undefined>,
  shouldSendProactive: Annotation<boolean>({
    reducer: (left, right) => right ?? left,
    default: () => false,
  }),
  proactiveCount: Annotation<number>({
    reducer: (left, right) => right ?? left,
    default: () => 0,
  }),
  maxProactiveMessages: Annotation<number | undefined>,
  
  // RAG context
  ragContext: Annotation<string | undefined>,
  
  // Evaluation
  needsEvaluation: Annotation<boolean>({
    reducer: (left, right) => right ?? left,
    default: () => false,
  }),
  evaluationComplete: Annotation<boolean>({
    reducer: (left, right) => right ?? left,
    default: () => false,
  }),
  
  // Analysis results
  lastEmotionAnalysis: Annotation<any>,
  lastSentimentAnalysis: Annotation<any>,
  lastQualityScores: Annotation<any>,
  
  // Metadata
  metadata: Annotation<any>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  
  // Error handling
  lastError: Annotation<string | undefined>,
  retryCount: Annotation<number>({
    reducer: (left, right) => right ?? left,
    default: () => 0,
  }),
  
  // Checkpoint
  checkpointId: Annotation<string | undefined>,
  checkpointVersion: Annotation<number | undefined>,
});

/**
 * Node names as constants for type safety
 */
export const NODE_NAMES = {
  PROCESS_USER_INPUT: 'process_user_input',
  FETCH_RAG_CONTEXT: 'fetch_rag_context',
  GENERATE_AI_RESPONSE: 'generate_ai_response',
  ANALYZE_RESPONSE: 'analyze_response',
  EVALUATE_GOALS: 'evaluate_goals',
  CHECK_PROACTIVE_TRIGGER: 'check_proactive_trigger',
  GENERATE_PROACTIVE_MESSAGE: 'generate_proactive_message',
  PERSIST_AND_EMIT: 'persist_and_emit',
  SCHEDULE_INACTIVITY: 'schedule_inactivity',
} as const;

/**
 * Conditional edge function: After processing user input, decide next step
 */
function afterUserInput(state: ConversationGraphState): string {
  console.log(`🔀 [afterUserInput] Deciding next step:`);
  console.log(`   - proactiveTrigger: ${state.proactiveTrigger}`);
  console.log(`   - needsEvaluation: ${state.needsEvaluation}`);
  
  // If proactive trigger is set (inactivity, start), skip normal response generation
  if (state.proactiveTrigger && !state.needsEvaluation) {
    console.log(`   ✅ Skipping normal response - going to CHECK_PROACTIVE_TRIGGER`);
    return NODE_NAMES.CHECK_PROACTIVE_TRIGGER;
  }
  
  // Otherwise, generate normal AI response
  console.log(`   ➡️  Proceeding with normal conversation flow - going to FETCH_RAG_CONTEXT`);
  return NODE_NAMES.FETCH_RAG_CONTEXT;
}

/**
 * Conditional edge function: Determine if proactive message should be sent
 * 
 * NOTE: For inactivity triggers, we don't check proactiveCount because:
 * - proactiveCount tracks consecutive proactive messages in a "burst" (followups/backchannels)
 * - inactivity nudges use inactivityNudgeCount instead (checked in checkProactiveTriggerNode)
 * 
 * IMPORTANT: After normal conversation (no proactiveTrigger set), we ALWAYS go to
 * PERSIST_AND_EMIT to save the AI's response, even if no followup/backchannel is being sent.
 */
function shouldSendProactiveMessage(state: ConversationGraphState): string {
  // For explicit inactivity/start triggers, only check shouldSendProactive (count already checked)
  if (state.proactiveTrigger === 'inactivity' || state.proactiveTrigger === 'start') {
    if (state.shouldSendProactive) {
      return NODE_NAMES.GENERATE_PROACTIVE_MESSAGE;
    }
    // Probability check failed, reschedule without persisting
    console.log(`   ⏭️  ${state.proactiveTrigger} probability check failed, rescheduling without persisting`);
    return NODE_NAMES.SCHEDULE_INACTIVITY;
  }
  
  // For followup/backchannel triggers, check both shouldSendProactive AND proactiveCount
  if (state.shouldSendProactive && state.proactiveCount < (state.maxProactiveMessages || 3)) {
    return NODE_NAMES.GENERATE_PROACTIVE_MESSAGE;
  }
  
  // If we're here, either:
  // 1. Normal conversation with no followup/backchannel → persist AI response and schedule inactivity
  // 2. Followup trigger that hit max count → persist last message
  // In both cases, go to persist
  console.log(`   ⏭️  No additional proactive message, proceeding to persist`);
  return NODE_NAMES.PERSIST_AND_EMIT;
}

/**
 * Conditional edge function: After generating proactive message, decide next step
 */
function afterProactiveMessage(state: ConversationGraphState): string {
  console.log(`🔀 [afterProactiveMessage] Deciding next step after proactive (trigger: ${state.proactiveTrigger}, count: ${state.proactiveCount}/${state.maxProactiveMessages || 0})`);
  
  // Always persist the proactive message first
  return NODE_NAMES.PERSIST_AND_EMIT;
  
  // Note: After persisting, afterPersist will check if we should loop back for more follow-ups
}

/**
 * Conditional edge function: After persisting, determine if we should schedule inactivity
 * 
 * LOGIC: We schedule inactivity whenever the AI sends a message and we're waiting for the user.
 * This happens in two scenarios:
 * 1. After a normal AI response (turn === 'user' means "user's turn to respond next")
 * 2. After a proactive message (start, inactivity, backchannel, final followup)
 * 
 * We skip scheduling only if:
 * - We're in an error state (turn is undefined/null)
 * - We've reached the max inactivity nudge count (handled by scheduleInactivityNode)
 */
function afterPersist(state: ConversationGraphState): string {
  console.log(`🔀 [afterPersist] Deciding next step (trigger: ${state.proactiveTrigger || 'none'}, count: ${state.proactiveCount}/${state.maxProactiveMessages || 0}, turn: ${state.turn})`);
  
  // Safety check: if proactiveCount >= maxProactiveMessages, we're done with burst
  // This prevents infinite loops even if trigger isn't cleared
  if (state.proactiveCount >= (state.maxProactiveMessages || 0) && (state.maxProactiveMessages || 0) > 0) {
    console.log(`   ✅ Burst complete (${state.proactiveCount}/${state.maxProactiveMessages}), scheduling inactivity`);
    return NODE_NAMES.SCHEDULE_INACTIVITY;
  }
  
  // After persisting, check if we need to send proactive follow-ups
  // BUT only if this was a normal conversation response (not already a proactive message)
  if (!state.proactiveTrigger && state.turn === 'user' && state.proactiveCount === 0) {
    console.log(`   ➡️  Main response persisted, checking for follow-ups`);
    return NODE_NAMES.CHECK_PROACTIVE_TRIGGER;
  }
  
  // If this was a follow-up, check if we should send more
  if (state.proactiveTrigger === 'followup' && state.proactiveCount < (state.maxProactiveMessages || 0)) {
    console.log(`   ➡️  Follow-up ${state.proactiveCount}/${state.maxProactiveMessages} persisted, checking for more`);
    return NODE_NAMES.CHECK_PROACTIVE_TRIGGER;
  }
  
  // Default: schedule inactivity and end
  if (state.turn === 'user') {
    console.log(`   ✅ Done with this turn, scheduling inactivity`);
    return NODE_NAMES.SCHEDULE_INACTIVITY;
  }
  
  // If turn is not 'user', something is wrong or we're in a transitional state
  // End the graph execution
  console.log(`⚠️ [afterPersist] Unexpected turn state: ${state.turn}, ending graph`);
  return END;
}

/**
 * Build and configure the conversation state graph
 */
export function buildConversationGraph() {
  console.log('  📐 Creating state graph structure...');
  // Create state graph with proper annotation
  const graph = new StateGraph(StateAnnotation) as any;

  console.log('  📌 Adding nodes to graph...');
  // Add all nodes
  graph.addNode(NODE_NAMES.PROCESS_USER_INPUT, processUserInputNode);
  graph.addNode(NODE_NAMES.FETCH_RAG_CONTEXT, fetchRagContextNode);
  graph.addNode(NODE_NAMES.GENERATE_AI_RESPONSE, generateAiResponseNode);
  graph.addNode(NODE_NAMES.ANALYZE_RESPONSE, analyzeResponseNode);
  graph.addNode(NODE_NAMES.EVALUATE_GOALS, evaluateGoalsNode);
  graph.addNode(NODE_NAMES.CHECK_PROACTIVE_TRIGGER, checkProactiveTriggerNode);
  graph.addNode(NODE_NAMES.GENERATE_PROACTIVE_MESSAGE, generateProactiveMessageNode);
  graph.addNode(NODE_NAMES.PERSIST_AND_EMIT, persistAndEmitNode);
  graph.addNode(NODE_NAMES.SCHEDULE_INACTIVITY, scheduleInactivityNode);
  console.log('  ✅ All nodes added');

  console.log('  🔗 Setting entry point and edges...');
  // Set entry point
  graph.setEntryPoint(NODE_NAMES.PROCESS_USER_INPUT);
  
  // Define the graph flow
  // After processing input, conditionally fetch RAG context OR skip to proactive check
  graph.addConditionalEdges(
    NODE_NAMES.PROCESS_USER_INPUT,
    afterUserInput,
  );
  
  // After RAG, generate AI response
  graph.addEdge(NODE_NAMES.FETCH_RAG_CONTEXT, NODE_NAMES.GENERATE_AI_RESPONSE);
  
  // After generating response, analyze it
  graph.addEdge(NODE_NAMES.GENERATE_AI_RESPONSE, NODE_NAMES.ANALYZE_RESPONSE);
  
  // After analysis, evaluate goals
  graph.addEdge(NODE_NAMES.ANALYZE_RESPONSE, NODE_NAMES.EVALUATE_GOALS);
  
  // After evaluation, persist the main AI response FIRST
  graph.addEdge(NODE_NAMES.EVALUATE_GOALS, NODE_NAMES.PERSIST_AND_EMIT);
  
  // After persisting main response, check if proactive message needed
  // This is added via conditional edges in afterPersist
  
  // Conditional: check_proactive_trigger → generate_proactive OR persist_and_emit
  graph.addConditionalEdges(
    NODE_NAMES.CHECK_PROACTIVE_TRIGGER,
    shouldSendProactiveMessage,
  );
  
  // Conditional: after generating proactive, decide next step
  graph.addConditionalEdges(
    NODE_NAMES.GENERATE_PROACTIVE_MESSAGE,
    afterProactiveMessage,
  );
  
  // Conditional: after persisting, schedule inactivity or end
  graph.addConditionalEdges(
    NODE_NAMES.PERSIST_AND_EMIT,
    afterPersist,
  );
  
  // After scheduling, we're done
  graph.addEdge(NODE_NAMES.SCHEDULE_INACTIVITY, END);
  console.log('  ✅ Graph structure complete');

  return graph;
}

/**
 * Compile the graph with checkpointing enabled
 */
export function compileConversationGraph() {
  try {
    // Temporarily disable LangSmith tracing during compilation to avoid network hangs
    const originalTracingValue = process.env.LANGCHAIN_TRACING_V2;
    process.env.LANGCHAIN_TRACING_V2 = 'false';
    
    const graph = buildConversationGraph();
    console.log('  💾 Initializing checkpointer...');
    const checkpointer = getCheckpointer();
    console.log('  ✅ Checkpointer ready');
    
    console.log('  ⚙️ Compiling graph...');
    const compiled = graph.compile({
      checkpointer,
    });
    console.log('  ✅ Graph compiled');
    
    // Restore original tracing value
    if (originalTracingValue !== undefined) {
      process.env.LANGCHAIN_TRACING_V2 = originalTracingValue;
    } else {
      delete process.env.LANGCHAIN_TRACING_V2;
    }
    
    return compiled;
  } catch (error) {
    console.error('❌ Failed to compile conversation graph:', error);
    throw error;
  }
}

/**
 * Singleton compiled graph instance
 */
let compiledGraphInstance: ReturnType<typeof compileConversationGraph> | null = null;

/**
 * Get or create the compiled graph instance
 */
export function getConversationGraph() {
  if (!compiledGraphInstance) {
    console.log('🔧 Compiling LangGraph conversation graph...');
    compiledGraphInstance = compileConversationGraph();
    console.log('✅ LangGraph conversation graph compiled successfully');
  }
  return compiledGraphInstance;
}

/**
 * Reset the graph instance (useful for testing or hot reload)
 */
export function resetConversationGraph() {
  compiledGraphInstance = null;
}

/**
 * Invoke the graph with an input
 */
export async function invokeConversationGraph(
  input: ConversationInput,
  config?: { threadId?: string; checkpointId?: string },
) {
  const graph = getConversationGraph();
  
  const runnableConfig = {
    configurable: {
      thread_id: config?.threadId || input.sessionId,
      checkpoint_id: config?.checkpointId,
    },
  };

  return graph.invoke(input, runnableConfig);
}

/**
 * Stream the graph execution for real-time updates
 */
export async function* streamConversationGraph(
  input: ConversationInput,
  config?: { threadId?: string; checkpointId?: string },
) {
  const graph = getConversationGraph();
  
  const runnableConfig = {
    configurable: {
      thread_id: config?.threadId || input.sessionId,
      checkpoint_id: config?.checkpointId,
    },
  };

  const stream = await graph.stream(input, runnableConfig);
  
  for await (const chunk of stream) {
    yield chunk;
  }
}

