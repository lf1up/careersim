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

**Conversation Goals (ordered stages)**:
{goalList}

**CURRENT STAGE (drive the conversation around this goal)**:
- Goal: {currentGoalTitle}
- Description: {currentGoalDescription}
- Key behaviors the user must demonstrate: {currentGoalKeyBehaviors}

**Stage Rules**:
- Stay in this stage until the goal is achieved.
- Do NOT act as if later stages are happening yet.
- If the user tries to jump ahead (e.g., closing early), acknowledge briefly and steer back to the current stage.
- Ask questions / shape the interaction to elicit the key behaviors.

**Conversation Style**: {conversationStyle}

**Style Guidelines**:
- Stay completely in character at all times
- Respond naturally and authentically to the user's messages
- Use appropriate vocabulary and tone for your role
- Reference your goals and motivations subtly when relevant
- Adapt your difficulty level to challenge the user appropriately
- Keep responses VERY conversational and short:
  - 1–3 short sentences (the less is better)
  - Ask at most 1 question per message
  - Avoid bullet points, numbered lists, and multi-paragraph answers unless the user explicitly asks for a detailed explanation

{ragContext}

**Important**: You are engaged in a realistic simulation. The user is practicing their skills. Be authentic, helpful, and true to your character.`),
]);

type GoalProgressStatus = 'not_started' | 'in_progress' | 'achieved';
type GoalProgressLike = { goalNumber: number; status: GoalProgressStatus } | undefined;

function getGoalStatus(goalProgress: GoalProgressLike[] | undefined, goalNumber: number): GoalProgressStatus {
  const item = goalProgress?.find((p) => p?.goalNumber === goalNumber);
  return item?.status || 'not_started';
}

function pickCurrentGoal(simulation: Simulation, goalProgress: GoalProgressLike[] = []) {
  const goals = (simulation as any)?.conversationGoals || [];
  const sorted = goals.slice().sort((a: any, b: any) => a.goalNumber - b.goalNumber);

  const nextRequired = sorted.find((g: any) => !g.isOptional && getGoalStatus(goalProgress, g.goalNumber) !== 'achieved');
  if (nextRequired) return nextRequired;

  const nextOptional = sorted.find((g: any) => !!g.isOptional && getGoalStatus(goalProgress, g.goalNumber) !== 'achieved');
  return nextOptional || null;
}

function formatGoalList(simulation: Simulation, goalProgress: GoalProgressLike[] = []): string {
  const goals = (simulation as any)?.conversationGoals || [];
  const sorted = goals.slice().sort((a: any, b: any) => a.goalNumber - b.goalNumber);

  if (!sorted.length) return '(No conversation goals configured)';

  return sorted
    .map((g: any) => {
      const status = getGoalStatus(goalProgress, g.goalNumber);
      return `#${g.goalNumber}${g.isOptional ? ' (optional)' : ''} [${status}] ${g.title}`;
    })
    .join('\n');
}

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
  SystemMessagePromptTemplate.fromTemplate(`You are {personaName}, a {personaRole}. The user has been silent for a while.

**Your Character**:
- Personality: {personaPersonality}
- Primary Goal: {personaPrimaryGoal}
- Current Context: {simulationScenario}

**What You Just Said**: 
{lastAiMessage}

**What User Last Said**: 
{lastUserMessage}

**Your Goal**: Send a brief, in-character nudge that DIRECTLY FOLLOWS UP on what you just said. Reference your last message and guide them forward.

**Nudge Style Hint**: {nudgeStyle}

**Recent Messages to Avoid Repetition**: 
{recentAiMessages}

**Critical Guidelines**:
- Keep it very brief (1-2 sentences max)
- DIRECTLY reference what you just asked or said in your last message
- Stay completely in character with your personality and role
- Be friendly and non-pushy, but contextually relevant
- If you asked a question, gently prompt them to answer it
- If you gave instructions, encourage them to follow through
- DO NOT repeat phrases or ideas from your recent messages above
- Use completely different vocabulary and approach than previous nudges
- Make it feel like a natural continuation of YOUR LAST MESSAGE, not a random comment`),
  HumanMessagePromptTemplate.fromTemplate(`Send a nudge now that follows up on what you just said.`),
]);

/**
 * Proactive message prompt for follow-up messages
 */
export const PROACTIVE_FOLLOWUP_PROMPT = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`You are {personaName}. You want to add something to continue the conversation naturally.

**Context**: 
- Last User Message: {lastUserMessage}
- Your Last Message: {lastAiMessage}

**Your Goal**: Add a VERY SHORT follow-up that stays in the SAME context as your last message.

**Recent Messages to Avoid Repetition**: 
{recentAiMessages}

**Critical Anti-Repetition Rules**:
{antiRepetitionGuidance}

**Guidelines**:
- Keep it VERY concise (1–2 short sentences; the less is better)
- DO NOT ask any new questions (no question marks)
- DO NOT introduce new topics or make radical context shifts
- Only add a small clarification, one extra detail, or a brief reassurance that directly relates to your last message
- Make it feel like a quick addendum, not a new turn`),
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
- Add a SMALL new detail or clarification that stays within the same context
- Never reuse sentence structures or patterns from above
- Avoid new questions; if you must guide, do it as a statement (no question marks)`;
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
  goalProgress: GoalProgressLike[] = [],
): Promise<string> {
  const objectives = Array.isArray(simulation.objectives)
    ? simulation.objectives.join(', ')
    : String(simulation.objectives || '');

  const current = pickCurrentGoal(simulation, goalProgress);
  const goalList = formatGoalList(simulation, goalProgress);

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
    goalList,
    currentGoalTitle: current ? `#${current.goalNumber} — ${current.title}` : '(All goals complete)',
    currentGoalDescription: current?.description || '(none)',
    currentGoalKeyBehaviors: Array.isArray(current?.keyBehaviors) ? current.keyBehaviors.join('; ') : '(none)',
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
  simulation: Simulation,
  lastUserMessage?: string,
  lastAiMessage?: string,
  recentAiMessages: string[] = [],
): Promise<string> {
  const cs: any = persona.conversationStyle || {};
  const nudgeStyle = String(cs.nudgeStyle || 'Friendly and encouraging');

  return await PROACTIVE_INACTIVITY_PROMPT.format({
    personaName: persona.name,
    personaRole: persona.role,
    personaPersonality: persona.personality,
    personaPrimaryGoal: persona.primaryGoal,
    simulationScenario: simulation.scenario,
    lastUserMessage: lastUserMessage || '(No recent message)',
    lastAiMessage: lastAiMessage || '(No previous message from you)',
    nudgeStyle,
    recentAiMessages: recentAiMessages.length > 0
      ? recentAiMessages.map((msg, i) => `${i + 1}. "${msg.slice(0, 150)}..."`).join('\n')
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

