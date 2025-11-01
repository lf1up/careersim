import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { ConversationGraphState, ProactiveTrigger } from '../state';
import { config } from '@/config/env';
import { compositeSimilarity } from '@/utils/textSimilarity';
import {
  buildProactiveStartPrompt,
  buildProactiveInactivityPrompt,
  buildProactiveFollowupPrompt,
  buildProactiveBackchannelPrompt,
} from '../prompts';

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
  console.log(`🔔 [${state.sessionId}] Checking proactive trigger`);

  const cs: any = state.persona?.conversationStyle || {};

  // If explicitly triggered (start, inactivity), validate against persona settings
  if (state.proactiveTrigger) {
    console.log(`   ✅ Proactive trigger set: ${state.proactiveTrigger}`);
    
    // For inactivity triggers, check max count AND inactivityProbability
    // Inactivity nudges are SCHEDULED by the system, but personas have different likelihood of sending them
    if (state.proactiveTrigger === 'inactivity') {
      const maxNudges = Number(cs.inactivityNudgeMaxCount ?? 2);
      const currentNudgeCount = state.metadata?.inactivityNudgeCount || 0;
      
      if (currentNudgeCount >= maxNudges) {
        console.log(`⚠️ Max inactivity nudges reached (${currentNudgeCount}/${maxNudges})`);
        return {
          shouldSendProactive: false,
        };
      }
      
      // Check inactivityProbability - how likely this persona is to send nudges
      const inactivityProbability = Math.max(0, Math.min(1, Number(cs.inactivityProbability ?? 0.5)));
      const roll = Math.random();
      
      if (roll >= inactivityProbability) {
        console.log(`❌ Persona didn't send inactivity nudge (rolled ${(roll * 100).toFixed(0)}%, needed <${(inactivityProbability * 100).toFixed(0)}%)`);
        // Don't increment count - this wasn't sent, so we should try again later
        return {
          shouldSendProactive: false,
        };
      }
      
      console.log(`📊 Inactivity nudge count: ${currentNudgeCount}/${maxNudges} - sending (${(inactivityProbability * 100).toFixed(0)}% probability passed)`);
    }
    
    return {
      shouldSendProactive: true,
      maxProactiveMessages: state.proactiveTrigger === 'followup' ? 3 : 1,
    };
  }

  // Check initiativeProbability - the "master gate" for SPONTANEOUS proactive behavior
  // This applies to unsolicited messages like backchannels, not system-triggered nudges
  const initiativeProbability = Math.max(0, Math.min(1, Number(cs.initiativeProbability) || 0));
  
  // For very low initiative personas (<15%), skip proactive checks entirely after normal responses
  // This prevents disengaged personas from being too chatty
  if (initiativeProbability < 0.15) {
    console.log(`❌ Persona has low initiative (${(initiativeProbability * 100).toFixed(0)}%) - skipping proactive checks`);
    return {
      shouldSendProactive: false,
    };
  }
  
  if (Math.random() >= initiativeProbability) {
    console.log(`❌ Persona didn't take initiative (${(initiativeProbability * 100).toFixed(0)}% chance)`);
    return {
      shouldSendProactive: false,
    };
  }
  
  console.log(`✅ Persona took initiative (${(initiativeProbability * 100).toFixed(0)}% chance passed)`);

  // Check for backchannel conditions (short/ambiguous user message)
  if (state.lastUserMessage) {
    const backchannelProbability = Math.max(0, Math.min(1, Number(cs.backchannelProbability) || 0));
    
    const trimmed = state.lastUserMessage.trim();
    const wordCount = trimmed.length > 0 ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    const isVeryShort = trimmed.length < 20 || wordCount <= 4;
    const isAmbiguous = /^(okay|ok|sure|yes|no|maybe|idk|i don't know|not sure|hmm|uh|what\??|thanks\.?|cool\.?|great\.?|fine\.?|good\.?|yep|nah|alright)\b/i.test(trimmed) || /\?\?\?$/.test(trimmed);

    if ((isVeryShort || isAmbiguous) && Math.random() < backchannelProbability) {
      console.log(`✅ Backchannel triggered (short/ambiguous message, ${(backchannelProbability * 100).toFixed(0)}% chance)`);
      return {
        shouldSendProactive: true,
        proactiveTrigger: 'backchannel',
        maxProactiveMessages: 1,
      };
    }
  }

  // Check for follow-up conditions (persona initiates multiple messages)
  const followupProbability = Math.max(0, Math.min(1, Number(cs.followupProbability) || 0));
  
  if (Math.random() < followupProbability) {
    console.log(`✅ Follow-up triggered (${(followupProbability * 100).toFixed(0)}% chance passed)`);
    return {
      shouldSendProactive: true,
      proactiveTrigger: 'followup',
      maxProactiveMessages: Number(cs.maxFollowupMessages) || 2,
    };
  }

  console.log(`❌ No proactive message needed (checked backchannel & followup)`);
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
      console.log(`   - inactivityNudgeMaxCount: ${cs.inactivityNudgeMaxCount ?? 2}`);
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
      maxTokens: Math.min(500, aiConfig.maxTokens), // Shorter for proactive
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
    let messageContent = response.content as string;

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
      messageContent = retryResponse.content as string;
      
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
        // Set a dummy lastAiMessage so persist node can save metadata
        lastAiMessage: '', // Empty string signals "skipped but update metadata"
      };
    }

    // Add to message history
    const updatedMessages = [...state.messages, new AIMessage(messageContent)];
    const processingTimeMs = Date.now() - startTime;
    const processingTimeSec = processingTimeMs / 1000;

    // Extract token count and model info from response
    const tokenCount = (response as any).response_metadata?.tokenUsage?.totalTokens || 0;
    const modelName = (response as any).response_metadata?.model || aiConfig.model;

    console.log(`✅ Proactive message generated in ${processingTimeMs}ms (${tokenCount} tokens, model: ${modelName})`);

    // Prepare metadata updates
    const metadataUpdates: any = {
      ...state.metadata,
      lastAiMessageAt: new Date(),
      messageCount: (state.metadata.messageCount || 0) + 1,
      processingTime: processingTimeSec,
      tokenCount,
      model: modelName,
    };
    
    // Increment inactivity nudge count if this is an inactivity trigger
    if (trigger === 'inactivity') {
      const currentCount = state.metadata?.inactivityNudgeCount || 0;
      metadataUpdates.inactivityNudgeCount = currentCount + 1;
      console.log(`📊 Incremented inactivity nudge count: ${currentCount} → ${currentCount + 1}`);
    }

    return {
      messages: updatedMessages,
      lastAiMessage: messageContent,
      proactiveCount: state.proactiveCount + 1,
      turn: trigger === 'backchannel' ? 'user' : 'user', // All proactive messages wait for user
      metadata: metadataUpdates,
    };
  } catch (error) {
    console.error('Error generating proactive message:', error);
    return {
      lastError: error instanceof Error ? error.message : 'Failed to generate proactive message',
      shouldSendProactive: false,
    };
  }
}

