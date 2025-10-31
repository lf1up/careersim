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
  
  // Turn management
  turn: Annotation<'user' | 'ai'>({
    reducer: (left, right) => right ?? left,
    default: () => 'ai' as const,
  }),
  
  // Last messages
  lastUserMessage: Annotation<string | undefined>,
  lastAiMessage: Annotation<string | undefined>,
  
  // Input field (for initial invocation)
  userMessage: Annotation<string | undefined>,
  
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
 * Conditional edge function: Determine if proactive message should be sent
 */
function shouldSendProactiveMessage(state: ConversationGraphState): string {
  // Check if we should send a proactive message
  if (state.shouldSendProactive && state.proactiveCount < (state.maxProactiveMessages || 3)) {
    return NODE_NAMES.GENERATE_PROACTIVE_MESSAGE;
  }
  
  // Otherwise, persist and finish
  return NODE_NAMES.PERSIST_AND_EMIT;
}

/**
 * Conditional edge function: After generating proactive message, decide next step
 */
function afterProactiveMessage(state: ConversationGraphState): string {
  // If it's a backchannel, we're done (wait for user)
  if (state.proactiveTrigger === 'backchannel') {
    return NODE_NAMES.PERSIST_AND_EMIT;
  }
  
  // For follow-ups, check if we should send another one
  if (state.proactiveTrigger === 'followup' && state.proactiveCount < (state.maxProactiveMessages || 3)) {
    // Loop back to check if we should send another
    return NODE_NAMES.CHECK_PROACTIVE_TRIGGER;
  }
  
  // Otherwise, persist and finish
  return NODE_NAMES.PERSIST_AND_EMIT;
}

/**
 * Conditional edge function: After persisting, determine if we're done
 */
function afterPersist(state: ConversationGraphState): string {
  // If this was a proactive message that needs scheduling (inactivity or start)
  if (state.proactiveTrigger === 'inactivity' || state.proactiveTrigger === 'start') {
    return NODE_NAMES.SCHEDULE_INACTIVITY;
  }
  
  // If we just sent a backchannel or follow-up, schedule inactivity for next user turn
  if (state.turn === 'user') {
    return NODE_NAMES.SCHEDULE_INACTIVITY;
  }
  
  // Otherwise, we're done
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
  // After processing input, fetch RAG context
  graph.addEdge(NODE_NAMES.PROCESS_USER_INPUT, NODE_NAMES.FETCH_RAG_CONTEXT);
  
  // After RAG, generate AI response
  graph.addEdge(NODE_NAMES.FETCH_RAG_CONTEXT, NODE_NAMES.GENERATE_AI_RESPONSE);
  
  // After generating response, analyze it
  graph.addEdge(NODE_NAMES.GENERATE_AI_RESPONSE, NODE_NAMES.ANALYZE_RESPONSE);
  
  // After analysis, evaluate goals
  graph.addEdge(NODE_NAMES.ANALYZE_RESPONSE, NODE_NAMES.EVALUATE_GOALS);
  
  // After evaluation, check if proactive message needed
  graph.addEdge(NODE_NAMES.EVALUATE_GOALS, NODE_NAMES.CHECK_PROACTIVE_TRIGGER);
  
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

