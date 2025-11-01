import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ConversationGraphState } from '../state';
import { config } from '@/config/env';
import { RAGService } from '@/services/rag';
import { transformersService } from '@/services/transformers';
import { buildPersonaSystemPrompt, formatRagContext } from '../prompts';

// Lazy imports to avoid TypeORM initialization during module load
let AppDataSource: any;
let SessionMessage: any;
let SimulationSession: any;

/**
 * Lazy-load database dependencies
 */
function loadDatabaseDependencies() {
  if (!AppDataSource) {
    AppDataSource = require('@/config/database').AppDataSource;
    SessionMessage = require('@/entities/SessionMessage').SessionMessage;
    SimulationSession = require('@/entities/SimulationSession').SimulationSession;
  }
}

/**
 * Helper to get message type from both LangChain objects and deserialized plain objects
 */
function getMessageType(message: any): string {
  // If it has _getType method (LangChain message), use it
  if (typeof message._getType === 'function') {
    return message._getType();
  }
  
  // Otherwise, check the type property or constructor name
  if (message.type) {
    return message.type;
  }
  
  // Check constructor name
  const constructorName = message.constructor?.name;
  if (constructorName === 'HumanMessage') return 'human';
  if (constructorName === 'AIMessage') return 'ai';
  if (constructorName === 'SystemMessage') return 'system';
  
  // Fallback: check id pattern (LangChain uses specific prefixes)
  if (message.id?.includes('HumanMessage')) return 'human';
  if (message.id?.includes('AIMessage')) return 'ai';
  if (message.id?.includes('SystemMessage')) return 'system';
  
  return 'unknown';
}

/**
 * Node: Process User Input
 * Entry point for the graph - loads session state and processes user message
 */
export async function processUserInputNode(
  state: ConversationGraphState | any,
): Promise<Partial<ConversationGraphState>> {
  console.log(`📥 [${state.sessionId}] Processing user input (trigger: ${state.proactiveTrigger || 'none'})`);

  try {
    // Load database dependencies
    loadDatabaseDependencies();
    
    // Handle initial input transformation (userMessage -> lastUserMessage)
    const userMessage = (state as any).userMessage || state.lastUserMessage;
    
    // Load session from database if not fully populated
    if (!state.persona || !state.simulation) {
      const sessionRepo = AppDataSource.getRepository(SimulationSession);
      const session = await sessionRepo.findOne({
        where: { id: state.sessionId },
        relations: ['simulation', 'simulation.personas', 'user'],
      });

      if (!session) {
        throw new Error(`Session ${state.sessionId} not found`);
      }

      const persona = (session.simulation?.personas as any)?.[0];
      if (!persona) {
        throw new Error('No persona found for simulation');
      }

      // Initialize state with loaded data
      const messages = state.messages || [];
      const updates: Partial<ConversationGraphState> = {
        persona,
        simulation: session.simulation!,
        messages,
        goalProgress: state.goalProgress || (session.goalProgress as any) || [],
        turn: session.turn || 'ai',
        shouldSendProactive: false,
        proactiveCount: state.proactiveCount || 0,
        needsEvaluation: false,
        evaluationComplete: false,
        metadata: {
          ...state.metadata,
          startedAt: session.startedAt,
          messageCount: session.messageCount || 0,
          conversationStyle: persona.conversationStyle,
          inactivityNudgeCount: session.inactivityNudgeCount || 0,
          inactivityNudgeAt: session.inactivityNudgeAt,
          lastAiMessageAt: session.lastAiMessageAt,
          lastUserMessageAt: session.lastUserMessageAt,
        },
      };

      // If this is a proactive trigger (inactivity, start), don't reset counters
      if (state.proactiveTrigger) {
        console.log(`   🔀 Proactive trigger detected: ${state.proactiveTrigger} - preserving inactivity state`);
        // Don't add user message, don't reset counters
        return updates;
      }

      // If we have a user message from the input, add it
      if (userMessage) {
        messages.push(new HumanMessage(userMessage));
        updates.messages = messages;
        updates.lastUserMessage = userMessage;
        updates.needsEvaluation = true;
        updates.turn = 'ai';
        
        // Reset counters since user is active
        updates.proactiveCount = 0; // Reset consecutive proactive message counter
        updates.metadata.inactivityNudgeCount = 0;
        updates.metadata.inactivityNudgeAt = null;
        console.log(`🔄 Reset inactivity nudge count and cleared schedule (user sent message)`);
        
        // Immediately update the database session to prevent race conditions with scheduler
        // This ensures the scheduler sees the cleared schedule right away
        try {
          const sessionRepo = AppDataSource.getRepository(SimulationSession);
          await sessionRepo.update(
            { id: state.sessionId },
            { 
              inactivityNudgeCount: 0, 
              inactivityNudgeAt: null as any,
              lastUserMessageAt: new Date(),
            },
          );
          console.log(`💾 Immediately persisted inactivity reset to database`);
        } catch (dbErr) {
          console.warn(`⚠️ Failed to immediately persist inactivity reset:`, dbErr);
          // Non-fatal, will be updated later by persistAndEmitNode
        }
      }

      return updates;
    }

    // If proactive trigger is set (start, inactivity), handle that FIRST
    // Don't reset counters - we're processing an inactivity nudge, not a user message
    if (state.proactiveTrigger) {
      console.log(`   🔀 Proactive trigger detected: ${state.proactiveTrigger} - skipping normal flow`);
      return {
        needsEvaluation: false,
        shouldSendProactive: false, // Will be set by check_proactive_trigger
      };
    }

    // If we have a user message, add it to the message history
    if (userMessage) {
      const messages = [...(state.messages || [])];
      messages.push(new HumanMessage(userMessage));

      // Immediately update the database to clear inactivity schedule
      // ONLY do this for actual user messages, not inactivity triggers
      try {
        const sessionRepo = AppDataSource.getRepository(SimulationSession);
        await sessionRepo.update(
          { id: state.sessionId },
          { 
            inactivityNudgeCount: 0, 
            inactivityNudgeAt: null as any,
            lastUserMessageAt: new Date(),
          },
        );
        console.log(`💾 Immediately persisted inactivity reset to database (user message received)`);
      } catch (dbErr) {
        console.warn(`⚠️ Failed to immediately persist inactivity reset:`, dbErr);
      }

      return {
        messages,
        lastUserMessage: userMessage,
        needsEvaluation: true,
        turn: 'ai',
        proactiveCount: 0, // Reset consecutive proactive message counter
        metadata: {
          ...state.metadata,
          inactivityNudgeCount: 0, // Reset on user activity
          inactivityNudgeAt: null, // Clear schedule
        },
      };
    }

    return {};
  } catch (error) {
    console.error('Error in processUserInputNode:', error);
    return {
      lastError: error instanceof Error ? error.message : 'Unknown error',
      retryCount: (state.retryCount || 0) + 1,
    };
  }
}

/**
 * Node: Fetch RAG Context
 * Calls the RAG microservice to get relevant context for the conversation
 */
export async function fetchRagContextNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  console.log(`🔍 Fetching RAG context for session ${state.sessionId}`);

  try {
    // Build query from recent user messages
    const recentUserMessages = state.messages
      .filter(m => getMessageType(m) === 'human')
      .slice(-3)
      .map(m => m.content as string);

    const query = [
      state.lastUserMessage || '',
      ...recentUserMessages,
      state.simulation?.title || '',
      state.simulation?.scenario || '',
    ]
      .filter(Boolean)
      .join(' | ');

    // Call RAG service
    const ragContext = await RAGService.buildRagContextForConversation({
      persona: state.persona,
      simulation: state.simulation,
      query,
    });

    return {
      ragContext: ragContext || undefined,
    };
  } catch (error) {
    console.warn('Error fetching RAG context:', error);
    // Don't fail the whole flow if RAG fails
    return {
      ragContext: undefined,
    };
  }
}

/**
 * Node: Generate AI Response
 * Core conversation node that generates persona response using ChatOpenAI
 */
export async function generateAiResponseNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  console.log(`🤖 Generating AI response for session ${state.sessionId}`);

  try {
    const startTime = Date.now();

    // Get AI configuration
    const aiConfig = config.ai.openai;
    
    // Initialize ChatOpenAI with persona-specific settings
    const model = new ChatOpenAI({
      modelName: aiConfig.model,
      temperature: aiConfig.temperature,
      maxTokens: aiConfig.maxTokens,
      topP: aiConfig.topP,
      frequencyPenalty: aiConfig.frequencyPenalty,
      presencePenalty: aiConfig.presencePenalty,
      openAIApiKey: aiConfig.apiKey,
      configuration: {
        baseURL: aiConfig.baseUrl,
      },
    });

    // Build system prompt
    const systemPromptText = await buildPersonaSystemPrompt(
      state.persona,
      state.simulation,
      state.ragContext,
    );

    // Prepare messages for the model
    const messages = [
      new SystemMessage(systemPromptText),
      ...state.messages,
    ];

    // Generate response
    const response = await model.invoke(messages);
    const aiMessageContent = response.content as string;

    // Add to message history
    const updatedMessages = [...state.messages, new AIMessage(aiMessageContent)];

    const processingTimeMs = Date.now() - startTime;
    const processingTimeSec = processingTimeMs / 1000;

    // Extract token count and model info from response
    const tokenCount = (response as any).response_metadata?.tokenUsage?.totalTokens || 0;
    const modelName = (response as any).response_metadata?.model || aiConfig.model;

    console.log(`✅ AI response generated in ${processingTimeMs}ms (${tokenCount} tokens, model: ${modelName})`);

    return {
      messages: updatedMessages,
      lastAiMessage: aiMessageContent,
      turn: 'user',
      metadata: {
        ...state.metadata,
        lastAiMessageAt: new Date(),
        messageCount: (state.metadata.messageCount || 0) + 1,
        processingTime: processingTimeSec,
        tokenCount,
        model: modelName,
      },
    };
  } catch (error) {
    console.error('Error generating AI response:', error);
    return {
      lastError: error instanceof Error ? error.message : 'Failed to generate AI response',
      retryCount: (state.retryCount || 0) + 1,
    };
  }
}

/**
 * Node: Analyze Response
 * Post-process the AI response with Transformers microservice
 */
export async function analyzeResponseNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  console.log(`📊 Analyzing AI response for session ${state.sessionId}`);

  if (!state.lastAiMessage) {
    return {};
  }

  try {
    // Run analyses in parallel
    const [emotionResult, sentimentResult] = await Promise.all([
      transformersService.analyzeEmotion(state.lastAiMessage).catch(() => ({
        emotion: 'neutral',
        confidence: 0.5,
        source: 'fallback' as const,
      })),
      transformersService.analyzeSentiment(state.lastAiMessage).catch(() => ({
        sentiment: 'neutral' as const,
        confidence: 0.5,
        source: 'fallback' as const,
      })),
    ]);

    console.log(`📊 Analysis complete: emotion=${emotionResult.emotion}, sentiment=${sentimentResult.sentiment}`);

    return {
      lastEmotionAnalysis: {
        emotion: emotionResult.emotion,
        confidence: emotionResult.confidence,
      },
      lastSentimentAnalysis: {
        sentiment: sentimentResult.sentiment,
        confidence: sentimentResult.confidence,
      },
    };
  } catch (error) {
    console.warn('Error analyzing response:', error);
    // Don't fail the flow if analysis fails
    return {};
  }
}

