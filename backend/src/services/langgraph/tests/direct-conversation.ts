/**
 * Direct Conversation Test Runner
 * 
 * Runs conversations directly against the LangGraph without DeepEval dependency.
 * Checks goal progress after each turn and stops when all goals are achieved.
 * Uses OpenAI to generate realistic, contextual user responses.
 */

import OpenAI from 'openai';
import { invokeGraph, invokeGraphWithTrigger, ConversationOutput } from './helpers';
import { GoalProgress } from './evaluation';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Conversation turn for logging
 */
export interface ConversationTurn {
  turnNumber: number;
  role: 'user' | 'assistant';
  content: string;
  duration: number;
  goalProgress: GoalProgress[];
}

/**
 * Result of a direct conversation test
 */
export interface DirectConversationResult {
  turns: ConversationTurn[];
  finalGoalProgress: GoalProgress[];
  totalDuration: number;
  goalsAchieved: boolean;
  stoppedEarly: boolean;
  stopReason: string;
}

/**
 * Run a direct conversation with the LangGraph
 * Checks goal progress after each turn and stops when all goals are achieved
 */
export async function runDirectConversation(
  threadId: string,
  maxTurns: number,
  startsWithAI: boolean,
  simulationContext: {
    title: string;
    scenario: string;
    objectives: string[];
    personaName: string;
    personaRole: string;
    conversationGoals: Array<{
      goalNumber: number;
      title: string;
      description: string;
      keyBehaviors: string[];
    }>;
  }
): Promise<DirectConversationResult> {
  const totalGoals = simulationContext.conversationGoals.length;
  const turns: ConversationTurn[] = [];
  const startTime = Date.now();
  let currentTurn = 0;
  let allGoalsAchieved = false;
  let stopReason = 'Max turns reached';

  console.log(`\n💬 STARTING DIRECT CONVERSATION`);
  console.log(`${'═'.repeat(80)}`);
  console.log(`🎯 Goal: Achieve all ${totalGoals} conversation goals`);
  console.log(`🔄 Max Turns: ${maxTurns}`);
  console.log(`🤖 AI Starts: ${startsWithAI ? 'Yes' : 'No'}`);
  console.log(`${'═'.repeat(80)}\n`);

  try {
    // If AI should start, trigger proactive start
    if (startsWithAI) {
      console.log('🤖 AI-INITIATED CONVERSATION');
      console.log(`${'─'.repeat(80)}`);
      const aiStartTime = Date.now();
      
      const startResponse = await invokeGraphWithTrigger(threadId, 'start');
      const aiDuration = Date.now() - aiStartTime;
      
      console.log(`🤖 AI PERSONA - Opening (${aiDuration}ms)`);
      console.log(`${'┄'.repeat(80)}`);
      console.log(startResponse.lastAiMessage);
      console.log(`${'┄'.repeat(80)}`);
      
      // Log goal progress
      logGoalProgress(startResponse.goalProgress, totalGoals);
      
      turns.push({
        turnNumber: 0,
        role: 'assistant',
        content: startResponse.lastAiMessage || '',
        duration: aiDuration,
        goalProgress: startResponse.goalProgress,
      });

      console.log('');
    }

    // Main conversation loop
    for (let i = 0; i < maxTurns; i++) {
      currentTurn = i + 1;
      
      console.log(`\n${'═'.repeat(80)}`);
      console.log(`🔄 TURN ${currentTurn} of ${maxTurns}`);
      console.log(`${'═'.repeat(80)}\n`);

      // Generate realistic user message using OpenAI
      const currentGoalProgress = turns.length > 0 
        ? turns[turns.length - 1].goalProgress 
        : [];
      
      const userMessage = await generateContextualUserMessage(currentTurn, turns, {
        ...simulationContext,
        currentGoalProgress,
      });
      
      console.log(`👤 USER INPUT`);
      console.log(`${'┄'.repeat(80)}`);
      console.log(userMessage);
      console.log(`${'┄'.repeat(80)}\n`);

      // Invoke the graph
      console.log(`   ⏳ Invoking LangGraph...`);
      const turnStartTime = Date.now();
      
      const response: ConversationOutput = await invokeGraph(threadId, userMessage);
      const turnDuration = Date.now() - turnStartTime;
      
      console.log(`\n🤖 AI PERSONA RESPONSE (${turnDuration}ms)`);
      console.log(`${'┄'.repeat(80)}`);
      console.log(response.lastAiMessage);
      console.log(`${'┄'.repeat(80)}\n`);

      // Log goal progress
      const goalProgress = response.goalProgress || [];
      logGoalProgress(goalProgress, totalGoals);

      // Record turn
      turns.push({
        turnNumber: currentTurn,
        role: 'user',
        content: userMessage,
        duration: 0,
        goalProgress,
      });
      
      turns.push({
        turnNumber: currentTurn,
        role: 'assistant',
        content: response.lastAiMessage || '',
        duration: turnDuration,
        goalProgress,
      });

      // Check if all goals are achieved
      if (goalProgress.length > 0) {
        const achievedGoals = goalProgress.filter(g => g.status === 'achieved').length;
        const inProgressGoals = goalProgress.filter(g => g.status === 'in_progress').length;
        
        console.log(`\n📈 GOAL PROGRESS SUMMARY:`);
        console.log(`   ✅ Achieved: ${achievedGoals}/${totalGoals}`);
        console.log(`   🔄 In Progress: ${inProgressGoals}/${totalGoals}`);
        console.log(`   ⏸️  Not Started: ${totalGoals - achievedGoals - inProgressGoals}/${totalGoals}\n`);

        if (achievedGoals === totalGoals) {
          allGoalsAchieved = true;
          stopReason = 'All goals achieved';
          console.log(`\n${'═'.repeat(80)}`);
          console.log(`🎉 SUCCESS! ALL ${totalGoals} GOALS ACHIEVED`);
          console.log(`${'═'.repeat(80)}`);
          console.log(`   Completed in ${currentTurn} turns (target was ${maxTurns})`);
          console.log(`   Stopped early - goals fully achieved!`);
          console.log(`${'═'.repeat(80)}\n`);
          break;
        }
      }

      // Small delay between turns to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const totalDuration = Date.now() - startTime;
    
    if (!allGoalsAchieved && currentTurn >= maxTurns) {
      console.log(`\n${'═'.repeat(80)}`);
      console.log(`⏰ CONVERSATION ENDED - MAX TURNS REACHED`);
      console.log(`${'═'.repeat(80)}`);
      console.log(`   Completed ${currentTurn} turns`);
      console.log(`   Some goals may not be fully achieved`);
      console.log(`${'═'.repeat(80)}\n`);
    }

    return {
      turns,
      finalGoalProgress: turns.length > 0 ? turns[turns.length - 1].goalProgress : [],
      totalDuration,
      goalsAchieved: allGoalsAchieved,
      stoppedEarly: allGoalsAchieved && currentTurn < maxTurns,
      stopReason,
    };

  } catch (error) {
    console.error(`\n${'═'.repeat(80)}`);
    console.error(`❌ CONVERSATION FAILED`);
    console.error(`${'═'.repeat(80)}`);
    console.error(`Error at turn ${currentTurn}:`, error);
    console.error(`${'═'.repeat(80)}\n`);
    throw error;
  }
}

/**
 * Generate a contextual user message using OpenAI
 * Creates realistic, dynamic responses based on conversation history and goals
 */
async function generateContextualUserMessage(
  turnNumber: number,
  previousTurns: ConversationTurn[],
  simulationContext: {
    title: string;
    scenario: string;
    objectives: string[];
    personaName: string;
    personaRole: string;
    conversationGoals: Array<{
      goalNumber: number;
      title: string;
      description: string;
      keyBehaviors: string[];
    }>;
    currentGoalProgress: GoalProgress[];
  }
): Promise<string> {
  try {
    // Build conversation history for context
    const conversationHistory = previousTurns
      .slice(-10) // Last 10 turns for context
      .map(t => ({
        role: t.role === 'user' ? 'user' : 'assistant',
        content: t.content,
      }));

    // Determine which goals still need work
    const achievedGoals = simulationContext.currentGoalProgress
      .filter(g => g.status === 'achieved')
      .map(g => `Goal ${g.goalNumber}: ${g.title} (✅ Achieved)`);
    
    const inProgressGoals = simulationContext.currentGoalProgress
      .filter(g => g.status === 'in_progress')
      .map(g => `Goal ${g.goalNumber}: ${g.title} (🔄 ${(g.confidence * 100).toFixed(0)}% progress)`);
    
    const notStartedGoals = simulationContext.currentGoalProgress
      .filter(g => g.status === 'not_started')
      .map(g => `Goal ${g.goalNumber}: ${g.title} (⏸️ Not started)`);

    // Create system prompt for the AI to roleplay as the user
    const systemPrompt = `You are roleplaying as a professional candidate in this simulation scenario:

**Simulation:** ${simulationContext.title}
**Scenario:** ${simulationContext.scenario}
**Your Objectives:** ${simulationContext.objectives.join(', ')}

**You are speaking with:** ${simulationContext.personaName} (${simulationContext.personaRole})

**Conversation Goals to Achieve:**
${achievedGoals.join('\n')}
${inProgressGoals.join('\n')}
${notStartedGoals.join('\n')}

**Your Role:** Generate a realistic, contextual response as the candidate. Your responses should:
1. Directly address any questions the interviewer asked
2. Progress toward achieving the conversation goals that haven't been completed yet
3. Be natural and authentic (not robotic or overly formal)
4. Use specific examples when appropriate (STAR method for behavioral questions)
5. Show genuine interest and engagement
6. Be appropriate for turn ${turnNumber} in the conversation

${turnNumber <= 5 ? '(Early conversation: Focus on building rapport and giving overview)' : ''}
${turnNumber > 5 && turnNumber <= 20 ? '(Mid conversation: Provide detailed examples, answer behavioral questions)' : ''}
${turnNumber > 20 ? '(Later conversation: Ask thoughtful questions, discuss next steps, show continued interest)' : ''}

Generate ONLY the candidate's response. Be concise but thorough (2-4 sentences typical, longer for STAR examples).`;

    // Call OpenAI to generate the user's next message
    console.log('   🤖 Generating realistic user response via OpenAI (GPT-4.1)...');
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1', // High-quality responses for realistic simulation
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        { 
          role: 'user', 
          content: turnNumber === 1 && conversationHistory.length === 0
            ? 'Generate an opening message from the candidate to start the conversation professionally.'
            : 'Continue the conversation as the candidate, addressing what the interviewer just said.',
        },
      ],
      temperature: 0.8, // Some creativity for realistic variety
      max_tokens: 500,
    });

    const userMessage = completion.choices[0]?.message?.content || '';
    
    if (!userMessage) {
      throw new Error('OpenAI returned empty response');
    }

    console.log('   ✅ Generated realistic user response\n');
    return userMessage;

  } catch (error: any) {
    console.error('   ⚠️  Failed to generate user message via OpenAI:', error.message);
    console.log('   ⚠️  Falling back to default message\n');
    
    // Fallback to simple message if API fails
    if (turnNumber === 1) {
      return "Hello! Thank you for taking the time to meet with me today. I'm excited to learn more about this opportunity.";
    }
    return "Thank you for that question. I'd be happy to provide more details about my experience and qualifications.";
  }
}

/**
 * Log goal progress with visual indicators
 */
function logGoalProgress(goalProgress: GoalProgress[], totalGoals: number): void {
  if (!goalProgress || goalProgress.length === 0) {
    console.log(`⚠️  No goal tracking data available yet\n`);
    return;
  }

  console.log(`📊 GOAL STATUS:`);
  console.log(`${'┄'.repeat(80)}`);
  
  goalProgress.forEach(goal => {
    const statusIcon = 
      goal.status === 'achieved' ? '✅' : 
      goal.status === 'in_progress' ? '🔄' : 
      '⏸️ ';
    const confidenceBar = '█'.repeat(Math.round(goal.confidence * 10)) + '░'.repeat(10 - Math.round(goal.confidence * 10));
    
    console.log(`${statusIcon} Goal ${goal.goalNumber}: ${goal.title}`);
    console.log(`   Progress: [${confidenceBar}] ${(goal.confidence * 100).toFixed(0)}%`);
  });
  
  const achieved = goalProgress.filter(g => g.status === 'achieved').length;
  const inProgress = goalProgress.filter(g => g.status === 'in_progress').length;
  
  console.log(`${'┄'.repeat(80)}`);
  console.log(`Summary: ${achieved}/${totalGoals} achieved, ${inProgress}/${totalGoals} in progress\n`);
}

/**
 * Log final conversation summary
 */
export function logConversationSummary(result: DirectConversationResult): void {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 CONVERSATION SUMMARY`);
  console.log(`${'═'.repeat(80)}`);
  console.log(`Total Turns: ${Math.floor(result.turns.length / 2)}`); // Divide by 2 since we count user+AI as one exchange
  console.log(`Total Duration: ${(result.totalDuration / 1000).toFixed(1)}s`);
  console.log(`Avg per Turn: ${(result.totalDuration / (result.turns.length / 2) / 1000).toFixed(1)}s`);
  console.log(`Goals Achieved: ${result.goalsAchieved ? 'Yes ✅' : 'No ❌'}`);
  console.log(`Stopped Early: ${result.stoppedEarly ? 'Yes (goals achieved)' : 'No'}`);
  console.log(`Stop Reason: ${result.stopReason}`);
  console.log(`${'═'.repeat(80)}\n`);

  // Log all turns
  console.log(`💬 COMPLETE CONVERSATION TRANSCRIPT`);
  console.log(`${'═'.repeat(80)}\n`);

  for (const turn of result.turns) {
    const roleIcon = turn.role === 'user' ? '👤' : '🤖';
    const roleLabel = turn.role === 'user' ? 'USER' : 'AI PERSONA';
    
    console.log(`${'─'.repeat(80)}`);
    console.log(`${roleIcon} ${roleLabel}${turn.duration > 0 ? ` (${turn.duration}ms)` : ''}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(turn.content);
    console.log('');
  }

  console.log(`${'═'.repeat(80)}`);
  console.log(`✅ End of conversation transcript`);
  console.log(`${'═'.repeat(80)}\n`);
}

