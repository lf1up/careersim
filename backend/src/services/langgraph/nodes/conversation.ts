import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ConversationGraphState } from '../state';
import { config } from '@/config/env';
import { RAGService } from '@/services/rag';
import { transformersService } from '@/services/transformers';
import { buildPersonaSystemPrompt } from '../prompts';
import { devLogLangGraphEvent } from '../devLogger';

// Lazy imports to avoid TypeORM initialization during module load
let AppDataSource: any;
let SimulationSession: any;
let SessionMessage: any;
let MessageType: any;

/**
 * Lazy-load database dependencies
 */
async function loadDatabaseDependencies() {
  if (!AppDataSource) {
    const databaseModule = await import('@/config/database');
    AppDataSource = databaseModule.AppDataSource;
    
    const simulationSessionModule = await import('@/entities/SimulationSession');
    SimulationSession = simulationSessionModule.SimulationSession;
    
    const SessionMessageModule = await import('@/entities/SessionMessage');
    SessionMessage = SessionMessageModule.SessionMessage;
    MessageType = SessionMessageModule.MessageType;
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
 * Extract text content from a LangChain/OpenAI response.
 * Some providers/models can return content as an array of parts or an object.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') return part.text || part.content || JSON.stringify(part);
        return String(part);
      })
      .join('')
      .trim();
  }

  if (content && typeof content === 'object') {
    const c: any = content;
    return String(c.text || c.content || JSON.stringify(c)).trim();
  }

  return String(content ?? '').trim();
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
    await devLogLangGraphEvent(state.sessionId, 'node:process_user_input:start', {
      proactiveTrigger: state.proactiveTrigger,
      userMessage: (state as any).userMessage,
      lastUserMessage: state.lastUserMessage,
      lastAiMessage: state.lastAiMessage,
      turn: state.turn,
      goalProgress: state.goalProgress,
      messageCount: Array.isArray(state.messages) ? state.messages.length : undefined,
    });
    // Load database dependencies
    await loadDatabaseDependencies();
    
    // Handle initial input transformation (userMessage -> lastUserMessage)
    // IMPORTANT: Check the INPUT for userMessage first - if present, it overrides any proactive trigger
    const userMessage = (state as any).userMessage;
    
    // If user sent a message, log it and we'll clear any stale proactive triggers
    if (userMessage) {
      console.log(`   📝 User message received: "${userMessage.substring(0, 50)}..."`);
      // If there was a stale proactive trigger, it will be cleared below
      if (state.proactiveTrigger) {
        console.log(`   🔄 Clearing stale proactive trigger: ${state.proactiveTrigger}`);
      }
    } else if (state.proactiveTrigger) {
      console.log(`   🔀 Proactive trigger present (no user message): ${state.proactiveTrigger}`);
    } else {
      console.log(`   ⚠️  No user message and no proactive trigger`);
    }
    
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

      // Priority 1: If user sent a message, ALWAYS process it (clears any stale triggers)
      if (userMessage) {
        messages.push(new HumanMessage(userMessage));
        updates.messages = messages;
        updates.lastUserMessage = userMessage;
        updates.needsEvaluation = true;
        updates.turn = 'ai';
        updates.proactiveTrigger = undefined; // Clear any stale triggers
        updates.proactiveCount = 0; // Reset burst counter
        
        // Reset inactivity tracking since user is active
        updates.metadata = {
          ...updates.metadata,
          inactivityNudgeCount: 0,
          inactivityNudgeAt: null,
          targetInactivityNudges: undefined, // Clear target so it can be re-rolled next time
        };
        console.log(`🔄 User sent message - cleared all proactive state and reset inactivity tracking`);
        await devLogLangGraphEvent(state.sessionId, 'node:process_user_input:user_message', {
          userMessage,
        });
        
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
        return updates;
      }
      
      // Priority 2: No user message, but proactive trigger - handle proactive flow
      if (state.proactiveTrigger) {
        console.log(`   🔀 Proactive trigger detected: ${state.proactiveTrigger} - preserving inactivity state`);
        await devLogLangGraphEvent(state.sessionId, 'node:process_user_input:proactive_trigger', {
          proactiveTrigger: state.proactiveTrigger,
        });
        // Reset proactiveCount for inactivity/start triggers (they use their own counters)
        if (state.proactiveTrigger === 'inactivity' || state.proactiveTrigger === 'start') {
          updates.proactiveCount = 0;
        }
        return updates;
      }
      
      // Neither user message nor proactive trigger - shouldn't happen
      console.log(`   ⚠️  No user message and no proactive trigger - returning current state`);
      return updates;
    }

    // Simpler branch: persona/simulation already loaded from checkpoint
    // Priority 1: If user sent a message, ALWAYS process it (clears any stale triggers)
    if (userMessage) {
      const messages = [...(state.messages || [])];
      messages.push(new HumanMessage(userMessage));

      // Immediately update the database to clear inactivity schedule
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
        proactiveTrigger: undefined, // Clear any stale triggers
        needsEvaluation: true,
        turn: 'ai',
        proactiveCount: 0, // Reset burst counter
        metadata: {
          ...state.metadata,
          inactivityNudgeCount: 0,
          inactivityNudgeAt: null,
          targetInactivityNudges: undefined, // Clear target for next session
        },
      };
    }
    
    // Priority 2: No user message but proactive trigger - handle proactive flow
    if (state.proactiveTrigger) {
      console.log(`   🔀 Proactive trigger detected: ${state.proactiveTrigger} - skipping normal flow`);
      await devLogLangGraphEvent(state.sessionId, 'node:process_user_input:proactive_trigger', {
        proactiveTrigger: state.proactiveTrigger,
      });
      const updates: any = {
        needsEvaluation: false,
        shouldSendProactive: false, // Will be set by check_proactive_trigger
      };
      // Reset proactiveCount for inactivity/start triggers (they use their own counters)
      if (state.proactiveTrigger === 'inactivity' || state.proactiveTrigger === 'start') {
        updates.proactiveCount = 0;
      }
      return updates;
    }

    return {};
  } catch (error) {
    console.error('Error in processUserInputNode:', error);
    await devLogLangGraphEvent(state.sessionId, 'node:process_user_input:error', {
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    });
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
      // Clamp max tokens to keep replies conversational even if OPENAI_MAX_TOKENS is very high.
      // (The system prompt also enforces brevity; this is a hard backstop.)
      // maxTokens: Math.min(aiConfig.maxTokens, 350),
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
      state.goalProgress,
    );
    await devLogLangGraphEvent(state.sessionId, 'node:generate_ai_response:prompt', {
      model: aiConfig.model,
      temperature: aiConfig.temperature,
      maxTokens: (model as any)?.maxTokens ?? aiConfig.maxTokens,
      prompt: systemPromptText,
    });

    // Prepare messages for the model
    const messages = [
      new SystemMessage(systemPromptText),
      ...state.messages,
    ];

    // Generate response
    const response = await model.invoke(messages);
    const aiMessageContent = extractTextContent((response as any).content);

    if (!aiMessageContent || aiMessageContent.trim().length === 0) {
      console.error('❌ Empty AI response content extracted:', {
        rawType: typeof (response as any).content,
        isArray: Array.isArray((response as any).content),
        rawPreview: JSON.stringify((response as any).content)?.slice?.(0, 300),
      });
      throw new Error('Empty AI response content extracted from model response');
    }
    await devLogLangGraphEvent(state.sessionId, 'node:generate_ai_response:result', {
      aiMessage: aiMessageContent,
      responseMetadata: (response as any).response_metadata,
      messages: [
        // log full conversation window content for debugging
        ...messages.map((m: any) => ({ type: typeof m?._getType === 'function' ? m._getType() : m.type, content: m.content })),
        { type: 'ai', content: aiMessageContent },
      ],
    });

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
    await devLogLangGraphEvent(state.sessionId, 'node:generate_ai_response:error', {
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    });
    return {
      lastError: error instanceof Error ? error.message : 'Failed to generate AI response',
      retryCount: (state.retryCount || 0) + 1,
    };
  }
}

/**
 * Node: Analyze User Input
 * Analyze the user message with Transformers microservice and persist to DB
 */
export async function analyzeUserInputNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  console.log(`📊 Analyzing user input for session ${state.sessionId}`);

  if (!state.lastUserMessage) {
    return {};
  }

  try {
    // Run analyses in parallel
    const [emotionResult, sentimentResult] = await Promise.all([
      transformersService.analyzeEmotion(state.lastUserMessage).catch(() => ({
        emotion: 'neutral',
        confidence: 0.5,
        source: 'fallback' as const,
      })),
      transformersService.analyzeSentiment(state.lastUserMessage).catch(() => ({
        sentiment: 'neutral' as const,
        confidence: 0.5,
        source: 'fallback' as const,
      })),
    ]);

    console.log(`📊 User analysis complete: emotion=${emotionResult.emotion}, sentiment=${sentimentResult.sentiment}`);

    const userAnalysis = {
      lastUserEmotionAnalysis: {
        emotion: emotionResult.emotion,
        confidence: emotionResult.confidence,
      },
      lastUserSentimentAnalysis: {
        sentiment: sentimentResult.sentiment,
        confidence: sentimentResult.confidence,
      },
    };

    // Persist user message to database with metadata
    try {
      await loadDatabaseDependencies();
      const messageRepo = AppDataSource.getRepository(SessionMessage);
      const sessionRepo = AppDataSource.getRepository(SimulationSession);

      // Check if this message already exists (prevent duplicates)
      const existingMessage = await messageRepo
        .createQueryBuilder('message')
        .where('message.sessionId = :sessionId', { sessionId: state.sessionId })
        .andWhere('message.type = :type', { type: MessageType.USER })
        .andWhere('message.content = :content', { content: state.lastUserMessage })
        .andWhere('message.createdAt > :recentTime', { recentTime: new Date(Date.now() - 5000) })
        .getOne();

      if (!existingMessage) {
        const session = await sessionRepo.findOne({ where: { id: state.sessionId } });
        if (!session) {
          console.warn('Session not found for user message persistence');
          return userAnalysis;
        }

        // Get next sequence number
        const lastMessage = await messageRepo
          .createQueryBuilder('message')
          .where('message.sessionId = :sessionId', { sessionId: state.sessionId })
          .orderBy('message.sequenceNumber', 'DESC')
          .getOne();

        const sequenceNumber = (lastMessage?.sequenceNumber || 0) + 1;

        // Create user message
        const userMessage = new SessionMessage();
        userMessage.session = session as any;
        userMessage.sequenceNumber = sequenceNumber;
        userMessage.type = MessageType.USER;
        userMessage.content = state.lastUserMessage;
        userMessage.timestamp = new Date();
        userMessage.metadata = {
          // Full analysis objects for programmatic access
          emotionAnalysis: userAnalysis.lastUserEmotionAnalysis,
          sentimentAnalysis: userAnalysis.lastUserSentimentAnalysis,
          // Flattened fields for frontend compatibility
          emotionalTone: emotionResult.emotion,
          sentiment: sentimentResult.sentiment,
          confidence: sentimentResult.confidence || emotionResult.confidence,
        };

        await messageRepo.save(userMessage);
        console.log(`💾 User message persisted to DB with metadata (seq: ${sequenceNumber})`);
      } else {
        // Message exists but might not have metadata - update it
        console.log(`📝 User message already exists, updating with metadata`);
        existingMessage.metadata = {
          // Merge with existing metadata
          ...existingMessage.metadata,
          // Full analysis objects for programmatic access
          emotionAnalysis: userAnalysis.lastUserEmotionAnalysis,
          sentimentAnalysis: userAnalysis.lastUserSentimentAnalysis,
          // Flattened fields for frontend compatibility
          emotionalTone: emotionResult.emotion,
          sentiment: sentimentResult.sentiment,
          confidence: sentimentResult.confidence || emotionResult.confidence,
        };
        await messageRepo.save(existingMessage);
        console.log(`✅ Updated user message metadata: emotion=${emotionResult.emotion}, sentiment=${sentimentResult.sentiment}`);
      }
    } catch (dbError) {
      console.warn('Error persisting user message to DB:', dbError);
      // Non-fatal, continue with analysis results
    }

    return userAnalysis;
  } catch (error) {
    console.warn('Error analyzing user input:', error);
    // Don't fail the flow if analysis fails
    return {};
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

    console.log(`📊 AI analysis complete: emotion=${emotionResult.emotion}, sentiment=${sentimentResult.sentiment}`);

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

