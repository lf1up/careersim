import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ConversationGraphState } from '../state';
import { config } from '@/config/env';
import { compositeSimilarity } from '@/utils/textSimilarity';
import { transformersService } from '@/services/transformers';
import {
  buildProactiveStartPrompt,
  buildProactiveInactivityPrompt,
  buildProactiveFollowupPrompt,
  buildProactiveBackchannelPrompt,
} from '../prompts';

// Lazy imports to avoid TypeORM initialization during module load
let AppDataSource: any;
let SimulationSession: any;

async function loadDatabaseDependencies() {
  if (!AppDataSource) {
    const databaseModule = await import('@/config/database');
    AppDataSource = databaseModule.AppDataSource;

    const simulationSessionModule = await import('@/entities/SimulationSession');
    SimulationSession = simulationSessionModule.SimulationSession;
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
 * Node: Check Proactive Trigger
 * Determines if a proactive message should be sent based on context
 */
export async function checkProactiveTriggerNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  console.log(`🔔 [${state.sessionId}] Checking proactive trigger (current: ${state.proactiveTrigger || 'none'}, count: ${state.proactiveCount || 0}/${state.maxProactiveMessages || 0})`);

  // Abort proactive work if a new user message arrived after the last AI message.
  // This prevents inactivity nudges or follow-up bursts from firing "over" a real user message.
  try {
    await loadDatabaseDependencies();
    const sessionRepo = AppDataSource.getRepository(SimulationSession);
    const session = await sessionRepo.findOne({ where: { id: state.sessionId } });

    if (session) {
      const lastUserAt: Date | undefined = session.lastUserMessageAt || undefined;
      const lastAiAt: Date | undefined = session.lastAiMessageAt || undefined;

      const userHasSpokenSinceLastAi = !!(lastUserAt && (!lastAiAt || lastUserAt.getTime() > lastAiAt.getTime()));
      const inactivityCleared = state.proactiveTrigger === 'inactivity' && session.inactivityNudgeAt == null;

      if (userHasSpokenSinceLastAi || inactivityCleared) {
        console.log(`🛑 Aborting proactive (${state.proactiveTrigger}) due to recent user activity`, {
          userHasSpokenSinceLastAi,
          inactivityCleared,
          lastUserAt,
          lastAiAt,
        });

        return {
          shouldSendProactive: false,
          // Keep proactiveTrigger as-is so routing doesn't accidentally enter normal conversation flow.
          // The graph will end early when it sees metadata.abortProactive.
          metadata: {
            ...state.metadata,
            abortProactive: true,
            lastUserMessageAt: lastUserAt,
            lastAiMessageAt: lastAiAt,
            inactivityNudgeAt: session.inactivityNudgeAt,
          },
          // Stop any follow-up burst immediately
          proactiveCount: state.maxProactiveMessages || state.proactiveCount || 0,
          maxProactiveMessages: state.maxProactiveMessages,
        };
      }
    }
  } catch (err) {
    // Non-fatal: if we can't check the DB, fall back to existing behavior.
    console.warn(`⚠️ Failed to check session timestamps for proactive abort:`, err);
  }

  const cs: any = state.persona?.conversationStyle || {};

  // If explicitly triggered (start, inactivity), validate against persona settings
  // BUT: if it's a followup and we've already started, just check the count
  if (state.proactiveTrigger === 'followup' && (state.proactiveCount || 0) > 0) {
    // We're in the middle of a burst - check if we should continue
    if (state.proactiveCount >= (state.maxProactiveMessages || 0)) {
      console.log(`❌ Follow-up burst complete (${state.proactiveCount}/${state.maxProactiveMessages})`);
      return { shouldSendProactive: false };
    }
    console.log(`✅ Continue follow-up burst (${state.proactiveCount}/${state.maxProactiveMessages})`);
    return {
      shouldSendProactive: true,
      maxProactiveMessages: state.maxProactiveMessages,
    };
  }
  
  if (state.proactiveTrigger) {
    console.log(`   ✅ Proactive trigger set: ${state.proactiveTrigger}`);
    
    // For inactivity triggers, check using inactivityNudges config
    if (state.proactiveTrigger === 'inactivity') {
      const nudges = cs.inactivityNudges;
      if (!nudges || typeof nudges !== 'object') {
        console.log(`⚠️ No inactivityNudges configured, skipping nudge`);
        return { shouldSendProactive: false };
      }
      
      const nudgeMin = Math.max(0, Number(nudges.min) || 0);
      const nudgeMax = Math.max(nudgeMin, Number(nudges.max) || 0);
      const currentNudgeCount = state.metadata?.inactivityNudgeCount || 0;
      
      // If max is 0, persona never sends nudges
      if (nudgeMax === 0) {
        console.log(`⚠️ Persona doesn't send inactivity nudges (max: 0)`);
        return { shouldSendProactive: false };
      }
      
      // Get or determine the target nudge count for this session
      // Similar to burstiness, we pick a random target once and stick to it
      let targetNudgeCount = state.metadata?.targetInactivityNudges;
      if (targetNudgeCount === undefined) {
        // First time - randomly pick between min and max
        targetNudgeCount = Math.floor(Math.random() * (nudgeMax - nudgeMin + 1)) + nudgeMin;
        console.log(`🎲 Randomly selected ${targetNudgeCount} inactivity nudges for this session (range: ${nudgeMin}-${nudgeMax})`);
      }
      
      // Check if we've reached the target
      if (currentNudgeCount >= targetNudgeCount) {
        console.log(`⚠️ Target inactivity nudges reached (${currentNudgeCount}/${targetNudgeCount})`);
        return { shouldSendProactive: false };
      }
      
      console.log(`📊 Sending inactivity nudge ${currentNudgeCount + 1}/${targetNudgeCount}`);
      
      // Store the target in metadata for future checks
      return {
        shouldSendProactive: true,
        metadata: {
          ...state.metadata,
          targetInactivityNudges: targetNudgeCount,
        },
      };
    }
    
    return {
      shouldSendProactive: true,
      maxProactiveMessages: state.proactiveTrigger === 'followup' ? 3 : 1,
    };
  }

  // Check for follow-up conditions based solely on burstiness
  // NOTE: This only applies to ADDITIONAL messages after the initial AI response
  // The initial response is always sent via the normal conversation flow
  const burst = cs.burstiness;
  if (burst && typeof burst === 'object') {
    const burstMin = Math.max(1, Number(burst.min) || 1);
    const burstMax = Math.max(burstMin, Number(burst.max) || 1);
    
    // If burstMax > 1, there's potential for follow-ups (additional messages beyond the first)
    if (burstMax > 1) {
      // Simple probability based on burst range: wider range = more likely to send multiple
      // This creates natural variation without complex probability gates
      const rangeFactor = (burstMax - burstMin) / (burstMax || 1);
      const burstProbability = 0.3 + (rangeFactor * 0.5); // 30-80% chance based on range
      
      if (Math.random() < burstProbability) {
        // Determine how many messages in this burst (1 to burstMax)
        const burstCount = Math.floor(Math.random() * (burstMax - burstMin + 1)) + burstMin;
        // maxProactiveMessages is the number of ADDITIONAL messages after the initial response
        const additionalMessages = Math.max(0, burstCount - 1);
        
        if (additionalMessages > 0) {
          console.log(`✅ Follow-up triggered (burst: ${burstCount} messages, ${additionalMessages} additional, ${(burstProbability * 100).toFixed(0)}% chance)`);
          return {
            shouldSendProactive: true,
            proactiveTrigger: 'followup',
            maxProactiveMessages: additionalMessages,
          };
        }
      }
    }
  }

  console.log(`❌ No additional proactive messages needed (initial response already generated)`);
  return {
    shouldSendProactive: false,
  };
}

/**
 * Node: Generate Proactive Message
 * Generates proactive messages with anti-repetition logic
 */
export async function generateProactiveMessageNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  const trigger = state.proactiveTrigger || 'followup';
  console.log(`💬 [${state.sessionId}] Generating proactive message (${trigger})`);

  try {
    const startTime = Date.now();
    console.log(`   ⏱️  Start time: ${new Date(startTime).toISOString()}`);
    
    // Log persona settings for inactivity
    if (trigger === 'inactivity') {
      const cs: any = state.persona?.conversationStyle || {};
      console.log(`📋 Persona inactivity settings:`);
      console.log(`   - inactivityNudgeDelaySec: ${JSON.stringify(cs.inactivityNudgeDelaySec || {})}`);
      console.log(`   - inactivityNudges: ${JSON.stringify(cs.inactivityNudges || {})}`);
      console.log(`   - nudgeStyle: ${cs.nudgeStyle || 'default'}`);
    }

    // Get recent AI messages for anti-repetition
    const recentAiMessages = state.messages
      .filter(m => getMessageType(m) === 'ai')
      .slice(-3)
      .map(m => m.content as string);

    console.log(`   🔍 Building prompt...`);
    // Build prompt based on trigger type
    let promptText: string;
    switch (trigger) {
    case 'start':
      promptText = await buildProactiveStartPrompt(state.persona, state.simulation);
      break;
    case 'inactivity':
      console.log(`   📝 Building inactivity prompt with context`);
      promptText = await buildProactiveInactivityPrompt(
        state.persona,
        state.simulation,
        state.lastUserMessage,
        state.lastAiMessage,
        recentAiMessages,
      );
      console.log(`   ✅ Prompt built (${promptText.length} chars)`);
      break;
    case 'followup':
      promptText = await buildProactiveFollowupPrompt(
        state.persona,
        state.lastUserMessage,
        state.lastAiMessage,
        recentAiMessages,
      );
      break;
    case 'backchannel':
      promptText = await buildProactiveBackchannelPrompt(state.persona, state.lastUserMessage);
      break;
    default:
      promptText = await buildProactiveFollowupPrompt(
        state.persona,
        state.lastUserMessage,
        state.lastAiMessage,
        recentAiMessages,
      );
    }

    // Initialize model with higher temperature for variety
    console.log(`   🤖 Initializing AI model...`);
    const aiConfig = config.ai.openai;
    const model = new ChatOpenAI({
      modelName: aiConfig.model,
      temperature: Math.min(1.0, aiConfig.temperature * 1.25), // Boost for variety
      maxTokens: aiConfig.maxTokens, // Use full token limit to avoid truncation
      topP: aiConfig.topP,
      frequencyPenalty: Math.min(2.0, aiConfig.frequencyPenalty + 0.3),
      presencePenalty: Math.min(2.0, aiConfig.presencePenalty + 0.2),
      openAIApiKey: aiConfig.apiKey,
      configuration: {
        baseURL: aiConfig.baseUrl,
      },
      timeout: 25000, // 25 second timeout for the AI call itself
    });

    // Generate message
    console.log(`   📡 Calling AI model (timeout: 25s)...`);
    const aiCallStart = Date.now();
    const response = await model.invoke(promptText);
    const aiCallDuration = Date.now() - aiCallStart;
    console.log(`   ✅ AI model responded in ${aiCallDuration}ms`);
    console.log(`   🔍 Response content type: ${typeof response.content}, isArray: ${Array.isArray(response.content)}`);
    
    // Handle different content formats
    let messageContent: string;
    if (typeof response.content === 'string') {
      messageContent = response.content;
    } else if (Array.isArray(response.content)) {
      // Content might be an array of message parts (multi-modal)
      console.log(`   📦 Content is array with ${response.content.length} parts`);
      messageContent = response.content.map((part: any) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          // Could be { type: 'text', text: '...' } format
          return part.text || part.content || JSON.stringify(part);
        }
        return String(part);
      }).join('');
    } else if (response.content && typeof response.content === 'object') {
      // Content might be an object with a text property
      console.log(`   📦 Content is object:`, JSON.stringify(response.content).substring(0, 200));
      messageContent = (response.content as any).text || (response.content as any).content || String(response.content);
    } else {
      messageContent = String(response.content || '');
    }
    
    console.log(`   📝 Extracted message content: ${messageContent.length} chars`);
    
    if (messageContent.length === 0) {
      console.error(`   ❌ EMPTY MESSAGE CONTENT! Raw response:`, JSON.stringify(response, null, 2).substring(0, 500));
      throw new Error('Empty message content extracted from AI response');
    }

    // Similarity check against recent messages
    const similarityThreshold = 0.82;
    let isTooSimilar = recentAiMessages.some(
      recentMsg => compositeSimilarity(recentMsg, messageContent) >= similarityThreshold,
    );

    // Retry once if too similar
    if (isTooSimilar && recentAiMessages.length > 0) {
      console.log(`⚠️ Message too similar, retrying with stronger anti-repetition prompt`);
      
      // Add stronger instruction
      const strongerPrompt = `${promptText}\n\n[CRITICAL: Your previous attempt was too similar to recent messages. Use COMPLETELY DIFFERENT vocabulary, sentence structure, and approach. Introduce a NEW angle or detail.]`;
      
      const retryResponse = await model.invoke(strongerPrompt);
      
      // Handle different content formats for retry
      if (typeof retryResponse.content === 'string') {
        messageContent = retryResponse.content;
      } else if (Array.isArray(retryResponse.content)) {
        messageContent = retryResponse.content.map((part: any) => 
          typeof part === 'string' ? part : part.text || ''
        ).join('');
      } else if (retryResponse.content && typeof retryResponse.content === 'object') {
        messageContent = (retryResponse.content as any).text || String(retryResponse.content);
      } else {
        messageContent = String(retryResponse.content || '');
      }
      
      console.log(`   📝 Retry content: ${messageContent.length} chars`);
      
      // Check again
      isTooSimilar = recentAiMessages.some(
        recentMsg => compositeSimilarity(recentMsg, messageContent) >= similarityThreshold,
      );
    }

    // If still too similar, skip sending
    if (isTooSimilar) {
      console.log(`⚠️ Skipping proactive message due to high similarity`);
      
      // For inactivity nudges, still increment the count to prevent infinite retries
      const metadataUpdates: any = {
        ...state.metadata,
      };
      
      if (trigger === 'inactivity') {
        const currentCount = state.metadata?.inactivityNudgeCount || 0;
        metadataUpdates.inactivityNudgeCount = currentCount + 1;
        console.log(`📊 Incremented inactivity nudge count despite skip: ${currentCount} → ${currentCount + 1}`);
      }
      
      return {
        shouldSendProactive: false,
        proactiveCount: state.proactiveCount + 1, // Count the attempt
        metadata: metadataUpdates,
        // Don't set lastAiMessage - let it preserve from previous state
      };
    }

    // Add to message history
    const updatedMessages = [...state.messages, new AIMessage(messageContent)];
    const processingTimeMs = Date.now() - startTime;
    const processingTimeSec = processingTimeMs / 1000;

    // Extract token count and model info from response (for logging and usage tracking)
    const tokenCount = (response as any).response_metadata?.tokenUsage?.totalTokens || 0;
    const modelName = (response as any).response_metadata?.model || aiConfig.model;

    console.log(`✅ Proactive message generated in ${processingTimeMs}ms (${tokenCount} tokens, model: ${modelName})`);

    // Analyze sentiment and emotion (same as regular AI messages)
    console.log(`📊 Analyzing proactive message sentiment and emotion...`);
    const [emotionResult, sentimentResult] = await Promise.all([
      transformersService.analyzeEmotion(messageContent).catch(() => ({
        emotion: 'neutral',
        confidence: 0.5,
        source: 'fallback' as const,
      })),
      transformersService.analyzeSentiment(messageContent).catch(() => ({
        sentiment: 'neutral' as const,
        confidence: 0.5,
        source: 'fallback' as const,
      })),
    ]);

    console.log(`📊 Proactive message analysis complete: emotion=${emotionResult.emotion}, sentiment=${sentimentResult.sentiment}`);

    // Prepare metadata updates
    const metadataUpdates: any = {
      ...state.metadata,
      lastAiMessageAt: new Date(),
      messageCount: (state.metadata.messageCount || 0) + 1,
      processingTime: processingTimeSec,
      tokenCount,
      model: modelName,
    };
    
    // Increment counters based on trigger type
    // IMPORTANT: inactivity/start use their own counters, NOT proactiveCount
    // proactiveCount is ONLY for followup/backchannel bursts
    let newProactiveCount = state.proactiveCount || 0;
    
    if (trigger === 'inactivity' || trigger === 'start') {
      // Inactivity and start don't increment proactiveCount
      if (trigger === 'inactivity') {
        const currentCount = state.metadata?.inactivityNudgeCount || 0;
        metadataUpdates.inactivityNudgeCount = currentCount + 1;
        console.log(`📊 Incremented inactivity nudge count: ${currentCount} → ${currentCount + 1}`);
      }
      console.log(`📝 Setting lastAiMessage with ${messageContent.length} chars: "${messageContent.substring(0, 50)}..."`);
    } else {
      // followup/backchannel increment proactiveCount
      newProactiveCount = (state.proactiveCount || 0) + 1;
      console.log(`📊 Proactive count: ${state.proactiveCount || 0} → ${newProactiveCount} (max: ${state.maxProactiveMessages || 0})`);
      console.log(`📝 Setting lastAiMessage with ${messageContent.length} chars: "${messageContent.substring(0, 50)}..."`);
    }
    
    return {
      messages: updatedMessages,
      lastAiMessage: messageContent,
      proactiveCount: newProactiveCount,
      turn: 'user', // All proactive messages wait for user
      metadata: metadataUpdates,
      // Include sentiment and emotion analysis results
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
    console.error('Error generating proactive message:', error);
    
    // Clear the trigger to prevent infinite loops on errors
    return {
      lastError: error instanceof Error ? error.message : 'Failed to generate proactive message',
      shouldSendProactive: false,
      proactiveTrigger: undefined, // Clear trigger to stop the loop
      proactiveCount: (state.proactiveCount || 0) + 1, // Increment to prevent retries
    };
  }
}

