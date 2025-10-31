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
  console.log(`🔔 Checking proactive trigger for session ${state.sessionId}`);

  // If explicitly triggered (start, inactivity), send proactive
  if (state.proactiveTrigger) {
    console.log(`✅ Proactive trigger set: ${state.proactiveTrigger}`);
    return {
      shouldSendProactive: true,
      maxProactiveMessages: state.proactiveTrigger === 'followup' ? 3 : 1,
    };
  }

  // Check for backchannel conditions (short/ambiguous user message)
  if (state.lastUserMessage) {
    const cs: any = state.persona.conversationStyle || {};
    const backchannelProbability = Math.max(0, Math.min(1, Number(cs.backchannelProbability) || 0));
    
    const trimmed = state.lastUserMessage.trim();
    const wordCount = trimmed.length > 0 ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    const isVeryShort = trimmed.length < 20 || wordCount <= 4;
    const isAmbiguous = /^(okay|ok|sure|yes|no|maybe|idk|i don't know|not sure|hmm|uh|what\??|thanks\.?|cool\.?|great\.?|fine\.?|good\.?|yep|nah|alright)\b/i.test(trimmed) || /\?\?\?$/.test(trimmed);

    if ((isVeryShort || isAmbiguous) && Math.random() < backchannelProbability) {
      console.log(`✅ Backchannel triggered (short/ambiguous message)`);
      return {
        shouldSendProactive: true,
        proactiveTrigger: 'backchannel',
        maxProactiveMessages: 1,
      };
    }
  }

  // Check for follow-up conditions (persona initiates multiple messages)
  const cs: any = state.persona.conversationStyle || {};
  const followupProbability = Math.max(0, Math.min(1, Number(cs.followupProbability) || 0));
  
  if (Math.random() < followupProbability) {
    console.log(`✅ Follow-up triggered`);
    return {
      shouldSendProactive: true,
      proactiveTrigger: 'followup',
      maxProactiveMessages: Number(cs.maxFollowupMessages) || 2,
    };
  }

  console.log(`❌ No proactive message needed`);
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
  console.log(`💬 Generating proactive message (${trigger}) for session ${state.sessionId}`);

  try {
    const startTime = Date.now();

    // Get recent AI messages for anti-repetition
    const recentAiMessages = state.messages
      .filter(m => getMessageType(m) === 'ai')
      .slice(-3)
      .map(m => m.content as string);

    // Build prompt based on trigger type
    let promptText: string;
    switch (trigger) {
    case 'start':
      promptText = await buildProactiveStartPrompt(state.persona, state.simulation);
      break;
    case 'inactivity':
      promptText = await buildProactiveInactivityPrompt(
        state.persona,
        state.lastUserMessage,
        recentAiMessages,
      );
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
    });

    // Generate message
    const response = await model.invoke(promptText);
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
      return {
        shouldSendProactive: false,
        proactiveCount: state.proactiveCount + 1, // Count the attempt
      };
    }

    // Add to message history
    const updatedMessages = [...state.messages, new AIMessage(messageContent)];
    const processingTime = Date.now() - startTime;

    console.log(`✅ Proactive message generated in ${processingTime}ms`);

    return {
      messages: updatedMessages,
      lastAiMessage: messageContent,
      proactiveCount: state.proactiveCount + 1,
      turn: trigger === 'backchannel' ? 'user' : 'user', // All proactive messages wait for user
      metadata: {
        ...state.metadata,
        lastAiMessageAt: new Date(),
        messageCount: (state.metadata.messageCount || 0) + 1,
        processingTime,
      },
    };
  } catch (error) {
    console.error('Error generating proactive message:', error);
    return {
      lastError: error instanceof Error ? error.message : 'Failed to generate proactive message',
      shouldSendProactive: false,
    };
  }
}

