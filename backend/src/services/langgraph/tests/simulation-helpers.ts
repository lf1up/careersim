/**
 * Simulation-Specific Test Helpers
 * 
 * Provides utilities for loading simulations from the database, creating sessions,
 * running simulation tests, and asserting goal achievement.
 */

import { ConversationSimulator, ConversationalGolden, ConversationalTestCase } from 'deepeval-ts';
import { 
  setupTestSession, 
  createModelCallback, 
  invokeGraphWithTrigger,
  TestSession,
  TestSimulation,
} from './helpers';
import {
  evaluateSuccessCriteria,
  evaluateGoalProgress,
  calculateSimulationScore,
  generateEvaluationReport,
  logEvaluationDetails,
  assertGoalAchievement,
  SuccessCriteria,
  ConversationGoal,
  SimulationEvaluation,
} from './evaluation';

const BASE_URL = process.env.LANGGRAPH_SERVER_URL || 'http://localhost:8123';

/**
 * Full simulation details from database
 */
export interface SimulationDetails extends TestSimulation {
  successCriteria: SuccessCriteria;
  conversationGoals: ConversationGoal[];
}

/**
 * Load a simulation by slug from the standalone server
 */
export async function loadSimulationBySlug(slug: string): Promise<SimulationDetails> {
  console.log(`\n📥 Loading simulation from database...`);
  console.log(`   Slug: ${slug}`);
  
  const response = await fetch(`${BASE_URL}/simulations`);
  if (!response.ok) {
    throw new Error(`Failed to fetch simulations: ${response.statusText}`);
  }
  
  const data = await response.json() as { simulations: SimulationDetails[] };
  console.log(`   Found ${data.simulations.length} total simulations in database`);
  
  const simulation = data.simulations.find(sim => sim.slug === slug);
  
  if (!simulation) {
    throw new Error(`Simulation not found: ${slug}`);
  }
  
  console.log(`   ✅ Simulation loaded: "${simulation.title}"`);
  console.log(`   Difficulty: ${simulation.difficulty}`);
  console.log(`   Persona: ${simulation.personas[0]?.name}`);
  console.log(`   Goals: ${simulation.conversationGoals?.length || 0}`);
  
  return simulation;
}

/**
 * Create a session for a specific simulation
 */
export async function createSimulationSession(
  simulationId: string,
  personaId: string
): Promise<TestSession> {
  console.log(`\n🔧 Creating test session...`);
  console.log(`   Simulation ID: ${simulationId}`);
  console.log(`   Persona ID: ${personaId}`);
  
  const session = await setupTestSession(simulationId, personaId);
  
  console.log(`   ✅ Session created successfully`);
  console.log(`   Session ID: ${session.id}`);
  console.log(`   Thread ID: ${session.threadId}`);
  
  return session;
}

/**
 * Run a complete simulation test with evaluation
 */
export async function runSimulationTest(
  simulation: SimulationDetails,
  scenario: ConversationalGolden,
  turnCount: number,
  startsWithAI: boolean = false
): Promise<{
  testCase: ConversationalTestCase;
  evaluation: SimulationEvaluation;
}> {
  // Create session
  const session = await createSimulationSession(
    simulation.id,
    simulation.personas[0].id
  );

  console.log(`\n${'='.repeat(80)}`);
  console.log(`🎬 STARTING SIMULATION TEST`);
  console.log(`${'='.repeat(80)}`);
  console.log(`📋 Simulation: ${simulation.title}`);
  console.log(`👤 Persona: ${simulation.personas[0].name} (${simulation.personas[0].role})`);
  console.log(`🎯 Target Turns: ${turnCount}`);
  console.log(`🔗 Session ID: ${session.id}`);
  console.log(`🧵 Thread ID: ${session.threadId}`);
  console.log(`${'='.repeat(80)}\n`);

  try {
    // If AI should start the conversation, trigger proactive start
    if (startsWithAI) {
      console.log('🤖 AI-Initiated Conversation');
      console.log('   Triggering proactive start message from AI persona...');
      const startTime = Date.now();
      await invokeGraphWithTrigger(session.threadId, 'start');
      const duration = Date.now() - startTime;
      console.log(`   ✅ AI started conversation (${duration}ms)\n`);
    }

    // Create model callback
    console.log('🔗 Setting up conversation pipeline...');
    const modelCallback = createModelCallback(session.id, session.threadId);
    console.log('   ✅ Model callback configured\n');

    // Create simulator
    console.log('🤖 Initializing DeepEval conversation simulator...');
    const simulator = new ConversationSimulator({
      modelCallback,
    });
    console.log('   ✅ Simulator ready\n');

    // Run simulation
    console.log(`🔄 RUNNING ${turnCount}-TURN CONVERSATION SIMULATION`);
    console.log(`${'─'.repeat(80)}`);
    console.log('   This will simulate a realistic conversation with the AI persona.');
    console.log('   Each turn represents a user message and AI response cycle.');
    console.log(`   Please wait, this may take several minutes...\n`);
    
    const simStartTime = Date.now();
    const conversationalTestCases = await simulator.simulate({
      conversationalGoldens: [scenario],
      maxUserSimulations: turnCount,
    });
    const simDuration = ((Date.now() - simStartTime) / 1000).toFixed(1);

    const testCase = conversationalTestCases[0];
    
    if (!testCase || !testCase.turns || testCase.turns.length === 0) {
      throw new Error('Simulation produced no conversation turns');
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`✅ CONVERSATION COMPLETED`);
    console.log(`   Total Turns: ${testCase.turns.length}`);
    console.log(`   Duration: ${simDuration}s`);
    console.log(`   Avg per turn: ${(parseFloat(simDuration) / testCase.turns.length).toFixed(1)}s`);
    console.log(`${'─'.repeat(80)}\n`);

    // Get final conversation state for goal progress
    console.log('📥 Fetching final session state...');
    const finalResponse = await fetch(`${BASE_URL}/sessions/${session.id}`);
    if (!finalResponse.ok) {
      throw new Error(`Failed to fetch final session state: ${finalResponse.statusText}`);
    }
    
    const sessionData = await finalResponse.json() as { session: any };
    const goalProgress = sessionData.session.goalProgress || [];
    console.log(`   ✅ Session state retrieved`);
    console.log(`   Goal progress entries: ${goalProgress.length}\n`);

    // Evaluate the conversation
    console.log('📊 EVALUATING CONVERSATION QUALITY');
    console.log(`${'─'.repeat(80)}`);
    
    console.log('\n1️⃣  Evaluating Success Criteria...');
    console.log('   Analyzing communication, problem-solving, and emotional aspects...');
    const successCriteriaEval = evaluateSuccessCriteria(
      testCase.turns,
      simulation.successCriteria
    );
    console.log(`   ✅ Success criteria evaluated: ${successCriteriaEval.overallScore.toFixed(1)}%`);

    console.log('\n2️⃣  Evaluating Goal Progress...');
    console.log('   Checking achievement of conversation goals...');
    const goalEvaluations = evaluateGoalProgress(
      goalProgress,
      simulation.conversationGoals
    );
    const achievedGoals = goalEvaluations.filter(g => g.achieved).length;
    const inProgressGoals = goalEvaluations.filter(g => g.inProgress).length;
    console.log(`   ✅ Goals analyzed: ${achievedGoals} achieved, ${inProgressGoals} in progress`);

    console.log('\n3️⃣  Calculating Overall Score...');
    console.log('   Weighting: 40% success criteria + 60% goal achievement...');
    const overallScore = calculateSimulationScore(
      successCriteriaEval.overallScore,
      goalEvaluations
    );
    console.log(`   ✅ Overall score calculated: ${overallScore}%\n`);

    console.log('4️⃣  Generating Evaluation Report...');
    const evaluation = generateEvaluationReport(
      simulation.slug,
      testCase.turns.length,
      successCriteriaEval,
      goalEvaluations,
      overallScore
    );
    console.log(`   ✅ Report generated\n`);
    console.log(`${'─'.repeat(80)}\n`);

    // Log detailed results
    logEvaluationDetails(evaluation);

    return {
      testCase,
      evaluation,
    };
  } catch (error) {
    console.error(`\n${'='.repeat(80)}`);
    console.error(`❌ SIMULATION TEST FAILED`);
    console.error(`${'='.repeat(80)}`);
    console.error(`Error:`, error);
    console.error(`${'='.repeat(80)}\n`);
    throw error;
  }
}

/**
 * Assert that a simulation passed with minimum thresholds
 */
export function assertSimulationPassed(
  evaluation: SimulationEvaluation,
  minOverallScore: number = 70,
  minGoalPercentage: number = 70
): void {
  console.log(`\n🔍 VALIDATING TEST RESULTS`);
  console.log(`${'─'.repeat(80)}`);
  
  // Check overall score
  console.log(`\n✓ Checking overall score threshold...`);
  console.log(`   Required: ${minOverallScore}%`);
  console.log(`   Actual: ${evaluation.overallScore}%`);
  
  if (evaluation.overallScore < minOverallScore) {
    console.log(`   ❌ FAILED: Score below minimum threshold\n`);
    throw new Error(
      `Simulation failed: Overall score ${evaluation.overallScore}% is below minimum ${minOverallScore}%`
    );
  }
  console.log(`   ✅ PASSED: Score meets minimum threshold`);

  // Check goal achievement
  console.log(`\n✓ Checking goal achievement threshold...`);
  console.log(`   Required: ${minGoalPercentage}%`);
  
  const requiredGoals = evaluation.goals.filter(g => !g.isOptional);
  const achieved = requiredGoals.filter(g => g.achieved || g.inProgress).length;
  const percentage = requiredGoals.length > 0 ? (achieved / requiredGoals.length) * 100 : 100;
  console.log(`   Actual: ${percentage.toFixed(1)}% (${achieved}/${requiredGoals.length} required goals)`);
  
  assertGoalAchievement(evaluation.goals, minGoalPercentage);
  console.log(`   ✅ PASSED: Goal achievement meets minimum threshold`);

  // If we get here, simulation passed
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`✅ ALL ASSERTIONS PASSED - SIMULATION SUCCESSFUL`);
  console.log(`${'─'.repeat(80)}\n`);
}

/**
 * Log conversation turns for debugging
 * Shows ALL turns with FULL content (no truncation)
 */
export function logConversationTurns(testCase: ConversationalTestCase, maxTurnsToShow?: number): void {
  const turnsToShow = maxTurnsToShow || testCase.turns.length; // Default to ALL turns
  const showingAll = turnsToShow >= testCase.turns.length;
  
  console.log(`\n💬 COMPLETE CONVERSATION TRANSCRIPT (${testCase.turns.length} Turns)`);
  console.log(`${'═'.repeat(80)}`);
  
  for (let i = 0; i < Math.min(turnsToShow, testCase.turns.length); i++) {
    const turn = testCase.turns[i];
    const role = turn.role === 'user' ? '👤 User' : '🤖 AI';
    const roleLabel = turn.role === 'user' ? 'USER' : 'AI PERSONA';
    
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`${role} ${roleLabel} - Turn ${i + 1} of ${testCase.turns.length}`);
    console.log(`${'─'.repeat(80)}`);
    
    // Show full content - no truncation
    const lines = turn.content.split('\n');
    lines.forEach(line => {
      console.log(line);
    });
  }
  
  console.log(`\n${'═'.repeat(80)}`);
  
  if (!showingAll) {
    console.log(`📝 Note: Showing first ${turnsToShow} of ${testCase.turns.length} turns`);
    console.log(`${'═'.repeat(80)}`);
  }
  
  console.log(`✅ End of conversation transcript\n`);
}

/**
 * Helper to get specific simulation scenario by slug
 */
export async function getSimulationScenario(slug: string): Promise<{
  simulation: SimulationDetails;
  turnCount: number;
  startsWithAI: boolean;
}> {
  const simulation = await loadSimulationBySlug(slug);
  
  // Map slug to turn count based on difficulty (all increased for better goal achievement)
  const turnCounts: Record<string, number> = {
    'behavioral-interview-brenda': 50,
    'data-analyst-technical-interview-priya': 50,
    'tech-cultural-interview-alex': 50,
    'pitching-idea-david': 50,
    'saying-no-sarah': 50,
    'reengaging-michael': 50,
    'delegating-task-chloe': 50,
  };

  // Determine if AI should start (based on persona's startsConversation property)
  const startsWithAI = simulation.personas[0]?.conversationStyle?.startsConversation === true;

  return {
    simulation,
    turnCount: turnCounts[slug] || 15,
    startsWithAI,
  };
}

