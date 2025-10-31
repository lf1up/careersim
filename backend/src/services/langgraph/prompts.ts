import { PromptTemplate, ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';

// Use type-only imports to avoid triggering TypeORM initialization
import type { Persona } from '@/entities/Persona';
import type { Simulation } from '@/entities/Simulation';

/**
 * Base system prompt for persona-based conversations
 * Incorporates persona details, simulation context, and conversation style
 */
export const PERSONA_SYSTEM_PROMPT = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`You are {personaName}, a {personaRole} with the following characteristics:

**Personality**: {personaPersonality}

**Primary Goal**: {personaPrimaryGoal}

**Hidden Motivation**: {personaHiddenMotivation}

**Difficulty Level**: {personaDifficultyLevel}

**Simulation Context**:
- Title: {simulationTitle}
- Scenario: {simulationScenario}
- Objectives: {simulationObjectives}

**Conversation Style**: {conversationStyle}

**Style Guidelines**:
- Stay completely in character at all times
- Respond naturally and authentically to the user's messages
- Use appropriate vocabulary and tone for your role
- Reference your goals and motivations subtly when relevant
- Adapt your difficulty level to challenge the user appropriately
- Keep responses concise and engaging (typically 2-4 sentences unless more detail is needed)

{ragContext}

**Important**: You are engaged in a realistic simulation. The user is practicing their skills. Be authentic, helpful, and true to your character.`),
]);

/**
 * Proactive message prompt for session start
 */
export const PROACTIVE_START_PROMPT = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`You are {personaName}, a {personaRole}. You are starting a conversation.

**Your Goal**: Open the conversation in a natural, engaging way that fits your character and the simulation context.

**Simulation**: {simulationTitle}
**Scenario**: {simulationScenario}

**Opening Style Hint**: {openingStyle}

**Guidelines**:
- Keep it brief and welcoming (1-2 sentences)
- Set the tone for the conversation
- Make it feel natural, not scripted
- Introduce yourself if appropriate for the context
- Give the user a clear opening to respond`),
  HumanMessagePromptTemplate.fromTemplate(`Start the conversation now.`),
]);

/**
 * Proactive message prompt for inactivity nudges
 */
export const PROACTIVE_INACTIVITY_PROMPT = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`You are {personaName}. The user has been silent for a while.

**Your Goal**: Send a friendly, in-character nudge to re-engage them.

**Last User Message**: {lastUserMessage}

**Nudge Style Hint**: {nudgeStyle}

**Recent Messages to Avoid Repetition**: 
{recentAiMessages}

**Critical Guidelines**:
- Keep it very brief (1 sentence typically)
- Stay in character
- Be friendly and non-pushy
- Reference something from the conversation if possible
- DO NOT repeat phrases or ideas from your recent messages above
- Use completely different vocabulary and approach than previous nudges`),
  HumanMessagePromptTemplate.fromTemplate(`Send a nudge now.`),
]);

/**
 * Proactive message prompt for follow-up messages
 */
export const PROACTIVE_FOLLOWUP_PROMPT = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`You are {personaName}. You want to add something to continue the conversation naturally.

**Context**: 
- Last User Message: {lastUserMessage}
- Your Last Message: {lastAiMessage}

**Your Goal**: Add a follow-up that advances the conversation in a meaningful way.

**Recent Messages to Avoid Repetition**: 
{recentAiMessages}

**Critical Anti-Repetition Rules**:
{antiRepetitionGuidance}

**Guidelines**:
- Keep it concise (1-2 sentences)
- Introduce NEW information, ask a NEW question, or share a DIFFERENT perspective
- Build on the conversation naturally
- Don't just repeat what you already said
- Make it feel like a natural part of the dialogue, not forced`),
  HumanMessagePromptTemplate.fromTemplate(`Add your follow-up now.`),
]);

/**
 * Proactive message prompt for backchannel/clarification requests
 */
export const PROACTIVE_BACKCHANNEL_PROMPT = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`You are {personaName}. The user's last message was very brief or unclear.

**Last User Message**: {lastUserMessage}

**Your Goal**: Ask for clarification or elaboration in a natural, conversational way.

**Guidelines**:
- Keep it very brief (1 short sentence or question)
- Be friendly and curious, not demanding
- Ask about something specific they mentioned
- Make it feel natural, like active listening
- Stay in character`),
  HumanMessagePromptTemplate.fromTemplate(`Ask for clarification now.`),
]);

/**
 * Helper to build anti-repetition guidance text
 */
export function buildAntiRepetitionGuidance(recentMessages: string[]): string {
  if (recentMessages.length === 0) {
    return '';
  }

  return `
You recently said: ${recentMessages.map((msg, i) => `(${i + 1}) "${msg.slice(0, 100)}..."`).join('; ')}

Your new message MUST:
- Use completely different vocabulary and phrasing
- Introduce a new topic, angle, or specific detail not yet mentioned
- Never reuse sentence structures or patterns from above
- If asking a question, make it about something entirely different
- If sharing information, provide a new fact or perspective`;
}

/**
 * Helper to format conversation style for prompts
 */
export function formatConversationStyle(style: any): string {
  if (!style) {
    return 'Natural, professional conversation';
  }

  try {
    return JSON.stringify(style, null, 2);
  } catch {
    return String(style);
  }
}

/**
 * Helper to format RAG context for injection
 */
export function formatRagContext(ragContext?: string): string {
  if (!ragContext || ragContext.trim().length === 0) {
    return '';
  }

  return `
**Grounding Knowledge**:
Use the following retrieved information to ground your responses only if relevant. Do not invent facts not supported here. Synthesize naturally and avoid quoting verbatim unless explicitly asked.

${ragContext}`;
}

/**
 * Build the persona system prompt with actual values
 */
export async function buildPersonaSystemPrompt(
  persona: Persona,
  simulation: Simulation,
  ragContext?: string,
): Promise<string> {
  const objectives = Array.isArray(simulation.objectives)
    ? simulation.objectives.join(', ')
    : String(simulation.objectives || '');

  return await PERSONA_SYSTEM_PROMPT.format({
    personaName: persona.name,
    personaRole: persona.role,
    personaPersonality: persona.personality,
    personaPrimaryGoal: persona.primaryGoal,
    personaHiddenMotivation: persona.hiddenMotivation,
    personaDifficultyLevel: String(persona.difficultyLevel),
    simulationTitle: simulation.title,
    simulationScenario: simulation.scenario,
    simulationObjectives: objectives,
    conversationStyle: formatConversationStyle(persona.conversationStyle),
    ragContext: formatRagContext(ragContext),
  });
}

/**
 * Build proactive start message prompt
 */
export async function buildProactiveStartPrompt(
  persona: Persona,
  simulation: Simulation,
): Promise<string> {
  const cs: any = persona.conversationStyle || {};
  const openingStyle = String(cs.openingStyle || 'Natural and welcoming');

  return await PROACTIVE_START_PROMPT.format({
    personaName: persona.name,
    personaRole: persona.role,
    simulationTitle: simulation.title,
    simulationScenario: simulation.scenario,
    openingStyle,
  });
}

/**
 * Build proactive inactivity nudge prompt
 */
export async function buildProactiveInactivityPrompt(
  persona: Persona,
  lastUserMessage?: string,
  recentAiMessages: string[] = [],
): Promise<string> {
  const cs: any = persona.conversationStyle || {};
  const nudgeStyle = String(cs.nudgeStyle || 'Friendly and encouraging');

  return await PROACTIVE_INACTIVITY_PROMPT.format({
    personaName: persona.name,
    lastUserMessage: lastUserMessage || '(No recent message)',
    nudgeStyle,
    recentAiMessages: recentAiMessages.length > 0
      ? recentAiMessages.map((msg, i) => `${i + 1}. "${msg.slice(0, 100)}..."`).join('\n')
      : '(No recent messages)',
  });
}

/**
 * Build proactive follow-up message prompt
 */
export async function buildProactiveFollowupPrompt(
  persona: Persona,
  lastUserMessage?: string,
  lastAiMessage?: string,
  recentAiMessages: string[] = [],
): Promise<string> {
  return await PROACTIVE_FOLLOWUP_PROMPT.format({
    personaName: persona.name,
    lastUserMessage: lastUserMessage || '(No recent user message)',
    lastAiMessage: lastAiMessage || '(No recent AI message)',
    recentAiMessages: recentAiMessages.length > 0
      ? recentAiMessages.map((msg, i) => `${i + 1}. "${msg.slice(0, 100)}..."`).join('\n')
      : '(No recent messages)',
    antiRepetitionGuidance: buildAntiRepetitionGuidance(recentAiMessages),
  });
}

/**
 * Build proactive backchannel prompt
 */
export async function buildProactiveBackchannelPrompt(
  persona: Persona,
  lastUserMessage?: string,
): Promise<string> {
  return await PROACTIVE_BACKCHANNEL_PROMPT.format({
    personaName: persona.name,
    lastUserMessage: lastUserMessage || '(No message)',
  });
}

