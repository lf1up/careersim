/**
 * End-to-End Test: Re-engaging a Disengaged Employee with Michael Reyes
 * 
 * Tests the "Re-engaging a Disengaged Employee" simulation with up to 50 conversation turns.
 * Evaluates performance management, active listening, and employee engagement strategies.
 * Stops automatically when all goals are achieved.
 */

import {
  startStandaloneServer,
  stopStandaloneServer,
  waitForServer,
  isDatabaseSeeded,
} from '../helpers';
import {
  loadSimulationBySlug,
  createSimulationSession,
} from '../simulation-helpers';
import {
  runDirectConversation,
  logConversationSummary,
} from '../direct-conversation';
import {
  evaluateSuccessCriteria,
  evaluateGoalProgress,
  calculateSimulationScore,
  generateEvaluationReport,
  logEvaluationDetails,
} from '../evaluation';
import { Turn } from 'deepeval-ts';

// Test configuration
const TEST_TIMEOUT = 3600000; // 60 minutes for full simulation (50 turns)
const MAX_TURNS = 50;

describe('Re-engaging a Disengaged Employee Simulation (Michael Reyes)', () => {
  // Global setup - start server once
  beforeAll(async () => {
    console.log('\n' + '═'.repeat(80));
    console.log('🚀 RE-ENGAGING EMPLOYEE TEST SUITE - SETUP');
    console.log('═'.repeat(80));
    console.log('Setting up test environment...\n');
    
    console.log('📡 Starting standalone LangGraph server...');
    await startStandaloneServer();
    console.log('⏳ Waiting for server to be ready...');
    await waitForServer();
    console.log('✅ Server is ready\n');
    
    console.log('🗄️  Checking database seed status...');
    const isSeeded = await isDatabaseSeeded();
    if (!isSeeded) {
      throw new Error('Database is not seeded. Please run: pnpm --filter careersim-backend run db:seed');
    }
    console.log('✅ Database is seeded and ready\n');
    
    console.log('═'.repeat(80));
    console.log('✅ TEST ENVIRONMENT READY');
    console.log('═'.repeat(80) + '\n');
  }, 60000);

  // Global cleanup
  afterAll(async () => {
    console.log('\n' + '═'.repeat(80));
    console.log('🧹 RE-ENGAGING EMPLOYEE TEST SUITE - CLEANUP');
    console.log('═'.repeat(80));
    console.log('Cleaning up test environment...\n');
    
    console.log('🛑 Stopping standalone server...');
    await stopStandaloneServer();
    console.log('✅ Server stopped\n');
    
    console.log('═'.repeat(80));
    console.log('✅ CLEANUP COMPLETE');
    console.log('═'.repeat(80) + '\n');
  }, 30000);

  test('should complete re-engagement conversation and achieve all goals', async () => {
    console.log('\n\n');
    console.log('╔' + '═'.repeat(78) + '╗');
    console.log('║' + ' Re-engaging Disengaged Employee - All Goals'.padEnd(78) + '║');
    console.log('╚' + '═'.repeat(78) + '╝');
    
    // Load simulation details
    const simulation = await loadSimulationBySlug('reengaging-michael');
    const startsWithAI = simulation.personas[0]?.conversationStyle?.startsConversation === true;
    
    console.log(`\n📋 Loaded: ${simulation.title}`);
    console.log(`👤 Persona: ${simulation.personas[0].name}`);
    console.log(`🎯 Goals: ${simulation.conversationGoals.length}`);
    console.log(`🔄 Max Turns: ${MAX_TURNS} (will stop early if all goals achieved)\n`);

    // Create session
    const session = await createSimulationSession(
      simulation.id,
      simulation.personas[0].id
    );

    // Run direct conversation with goal tracking
    const result = await runDirectConversation(
      session.threadId,
      MAX_TURNS,
      startsWithAI,
      {
        title: simulation.title,
        scenario: simulation.scenario,
        objectives: simulation.objectives,
        personaName: simulation.personas[0].name,
        personaRole: simulation.personas[0].role,
        conversationGoals: simulation.conversationGoals,
      }
    );

    // Log complete conversation
    logConversationSummary(result);

    // Convert turns to DeepEval format for evaluation
    const evaluationTurns = result.turns.map(t => new Turn({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.content,
    }));

    // Evaluate the conversation
    console.log('📊 EVALUATING CONVERSATION QUALITY');
    console.log(`${'─'.repeat(80)}\n`);

    const successCriteriaEval = evaluateSuccessCriteria(
      evaluationTurns,
      simulation.successCriteria
    );

    const goalEvaluations = evaluateGoalProgress(
      result.finalGoalProgress,
      simulation.conversationGoals
    );

    const overallScore = calculateSimulationScore(
      successCriteriaEval.overallScore,
      goalEvaluations
    );

    const evaluation = generateEvaluationReport(
      simulation.slug,
      Math.floor(result.turns.length / 2),
      successCriteriaEval,
      goalEvaluations,
      overallScore
    );

    logEvaluationDetails(evaluation);

    // Assertions
    expect(result.turns.length).toBeGreaterThanOrEqual(10);
    expect(evaluation.overallScore).toBeGreaterThanOrEqual(50);
    
    const goalsAchievedOrInProgress = goalEvaluations.filter(
      g => g.achieved || g.inProgress
    ).length;
    expect(goalsAchievedOrInProgress).toBeGreaterThan(0);

    if (result.stoppedEarly) {
      console.log('\n🎉 SUCCESS: All goals achieved before max turns!');
      const requiredGoals = goalEvaluations.filter(g => !g.isOptional);
      const allRequiredAchieved = requiredGoals.every(g => g.achieved);
      expect(allRequiredAchieved).toBe(true);
    }

    console.log('\n✅ Re-engaging Employee simulation test completed successfully');
  }, TEST_TIMEOUT);
});
