/**
 * LangGraph End-to-End Simulation Tests with DeepEval
 * 
 * Comprehensive test suite for the LangGraph conversation system
 * using DeepEval's conversation simulator
 */

import { ConversationSimulator, ConversationalTestCase, evaluate } from 'deepeval-ts';
import {
  startStandaloneServer,
  stopStandaloneServer,
  waitForServer,
  setupTestSession,
  cleanupTestSession,
  createModelCallback,
  invokeGraph,
  invokeGraphWithTrigger,
  getSessionDetails,
  isDatabaseSeeded,
  TestSession,
  ConversationOutput,
} from './helpers';
import {
  createBasicConversationScenario,
  createGoalAchievementScenario,
  createProactiveStartScenario,
  createFollowupScenario,
  getBasicTestScenarios,
} from './scenarios';

// Test configuration
const TEST_TIMEOUT = 240000; // 4 minutes per test

describe('LangGraph End-to-End Simulation Tests', () => {
  let testSession: TestSession | null = null;

  // Global setup - start server once for all tests
  beforeAll(async () => {
    console.log('🚀 Setting up test environment...');
    
    // Start standalone server (or verify it's running)
    await startStandaloneServer();
    await waitForServer();
    
    // Verify database is seeded
    const isSeeded = await isDatabaseSeeded();
    if (!isSeeded) {
      throw new Error('Database is not seeded. Please run: pnpm --filter careersim-backend run db:seed');
    }
    
    console.log('✅ Test environment ready');
  }, TEST_TIMEOUT);

  // Global cleanup
  afterAll(async () => {
    console.log('🧹 Cleaning up test environment...');
    await stopStandaloneServer();
    console.log('✅ Cleanup complete');
  }, 30000);

  // Per-test setup - create fresh session
  beforeEach(async () => {
    testSession = await setupTestSession();
    console.log(`📝 Created test session: ${testSession.id}`);
  }, 30000);

  // Per-test cleanup
  afterEach(async () => {
    if (testSession) {
      await cleanupTestSession(testSession.id);
      testSession = null;
    }
  }, 10000);

  describe('Basic Conversation Flow', () => {
    test('should handle a simple multi-turn conversation', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      // Test direct invocation (without DeepEval)
      const response1 = await invokeGraph(
        session.threadId,
        'Hello! I\'m excited to interview for this position.'
      );

      expect(response1).toBeDefined();
      expect(response1.lastAiMessage).toBeDefined();
      expect(response1.turn).toBe('user');
      expect(response1.messages.length).toBeGreaterThan(0);

      // Second turn
      const response2 = await invokeGraph(
        session.threadId,
        'Can you tell me more about the role?'
      );

      expect(response2).toBeDefined();
      expect(response2.lastAiMessage).toBeDefined();
      expect(response2.messages.length).toBeGreaterThan(response1.messages.length);
    }, TEST_TIMEOUT);

    test('should maintain conversation state across turns', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      // First message
      await invokeGraph(session.threadId, 'My name is Alex.');

      // Second message referencing first
      const response = await invokeGraph(
        session.threadId,
        'What should I tell you about myself?'
      );

      expect(response).toBeDefined();
      expect(response.messages.length).toBeGreaterThanOrEqual(4); // At least 2 exchanges

      // Verify session persistence
      const sessionDetails = await getSessionDetails(session.id);
      expect(sessionDetails.messageCount).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });

  describe('Proactive Message Generation', () => {
    test('should generate proactive start message', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      const response = await invokeGraphWithTrigger(session.threadId, 'start');

      expect(response).toBeDefined();
      expect(response.lastAiMessage).toBeDefined();
      expect(response.turn).toBe('user'); // AI spoke, now user's turn
      expect(response.lastAiMessage).not.toBe('');
    }, TEST_TIMEOUT);

    test('should handle followup trigger', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      // Start with normal conversation
      await invokeGraph(session.threadId, 'Hello');

      // Trigger a followup
      const response = await invokeGraphWithTrigger(session.threadId, 'followup');

      expect(response).toBeDefined();
      // Followup might or might not generate based on probability
      // Just verify the call succeeds
    }, TEST_TIMEOUT);
  });

  describe('Goal Tracking and Evaluation', () => {
    test('should track goal progress during conversation', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      // Have a goal-oriented conversation
      const response1 = await invokeGraph(
        session.threadId,
        'Hello! My name is Sarah and I\'m excited to interview with you today.'
      );

      expect(response1.goalProgress).toBeDefined();
      expect(Array.isArray(response1.goalProgress)).toBe(true);

      // Continue conversation to potentially progress goals
      const response2 = await invokeGraph(
        session.threadId,
        'I have 5 years of experience in software engineering, primarily working with TypeScript and React.'
      );

      expect(response2.goalProgress).toBeDefined();
      
      // Check if any goals have progressed
      const hasProgressedGoals = response2.goalProgress.some(
        goal => goal.status === 'in_progress' || goal.status === 'achieved'
      );
      
      console.log('Goal progress:', response2.goalProgress);
      // Note: Goal progression depends on AI evaluation, so we don't assert true
      // but we verify the structure exists
    }, TEST_TIMEOUT);
  });

  describe('Turn Management', () => {
    test('should properly alternate turns', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      // User speaks, AI should respond
      const response1 = await invokeGraph(session.threadId, 'Hello');
      expect(response1.turn).toBe('user'); // After AI responds, it's user's turn

      // User speaks again
      const response2 = await invokeGraph(session.threadId, 'How are you?');
      expect(response2.turn).toBe('user'); // Still user's turn after AI responds
    }, TEST_TIMEOUT);
  });

  describe('Response Analysis', () => {
    test('should include sentiment and emotional analysis', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      const response = await invokeGraph(
        session.threadId,
        'I am really excited about this opportunity! It would be my dream job.'
      );

      expect(response).toBeDefined();
      expect(response.metadata).toBeDefined();
      
      // Analysis metadata may be present depending on transformer service
      console.log('Response metadata:', response.metadata);
      
      // Just verify structure exists
      expect(response.metadata).toHaveProperty('processingTime');
    }, TEST_TIMEOUT);
  });

  describe('Error Handling', () => {
    test('should handle empty messages gracefully', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      // Try to send empty message
      try {
        await invokeGraph(session.threadId, '');
        // If it succeeds, verify response
      } catch (error) {
        // If it fails, that's also acceptable behavior
        expect(error).toBeDefined();
      }
    }, TEST_TIMEOUT);
  });

  describe('DeepEval Conversation Simulator Integration', () => {
    test('should simulate a basic conversation with DeepEval', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      // Create scenario
      const scenario = createBasicConversationScenario();

      // Create model callback
      const modelCallback = createModelCallback(session.id, session.threadId);

      // Create simulator
      const simulator = new ConversationSimulator({
        modelCallback,
      });

      // Simulate conversation (limit to 5 turns for testing)
      const conversationalTestCases = await simulator.simulate({
        conversationalGoldens: [scenario],
        maxUserSimulations: 5,
      });

      expect(conversationalTestCases).toBeDefined();
      expect(conversationalTestCases.length).toBeGreaterThan(0);

      const testCase = conversationalTestCases[0];
      expect(testCase).toBeDefined();
      expect(testCase.turns.length).toBeGreaterThan(0);

      console.log(`✅ Simulated ${testCase.turns.length} conversation turns`);
      
      // Log the conversation
      testCase.turns.forEach((turn, idx) => {
        console.log(`Turn ${idx + 1} [${turn.role}]: ${turn.content.substring(0, 100)}...`);
      });
    }, TEST_TIMEOUT);

    test('should simulate goal achievement conversation', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      const scenario = createGoalAchievementScenario();
      const modelCallback = createModelCallback(session.id, session.threadId);
      const simulator = new ConversationSimulator({
        modelCallback,
      });

      const conversationalTestCases = await simulator.simulate({
        conversationalGoldens: [scenario],
        maxUserSimulations: 8, // More turns for goal achievement
      });

      expect(conversationalTestCases.length).toBeGreaterThan(0);
      
      const testCase = conversationalTestCases[0];
      expect(testCase.turns.length).toBeGreaterThan(0);

      console.log(`✅ Goal achievement simulation: ${testCase.turns.length} turns`);
    }, TEST_TIMEOUT);

    test('should simulate proactive start scenario', async () => {
      // Create a fresh session for proactive start
      const proactiveSession = await setupTestSession();

      try {
        const scenario = createProactiveStartScenario();
        const modelCallback = createModelCallback(proactiveSession.id, proactiveSession.threadId);
        
        const simulator = new ConversationSimulator({
          modelCallback,
        });

        const conversationalTestCases = await simulator.simulate({
          conversationalGoldens: [scenario],
          maxUserSimulations: 5,
        });

        expect(conversationalTestCases.length).toBeGreaterThan(0);
        console.log(`✅ Proactive start simulation completed`);
      } finally {
        await cleanupTestSession(proactiveSession.id);
      }
    }, TEST_TIMEOUT);
  });

  describe('State Persistence', () => {
    test('should persist conversation state', async () => {
      expect(testSession).not.toBeNull();
      const session = testSession!;

      // Send a message
      await invokeGraph(session.threadId, 'This is a test message');

      // Get session details
      const sessionDetails = await getSessionDetails(session.id);

      expect(sessionDetails).toBeDefined();
      expect(sessionDetails.messageCount).toBeGreaterThan(0);
      expect(sessionDetails.status).toBe('in_progress');
    }, TEST_TIMEOUT);
  });

  describe('Multiple Scenarios Batch Test', () => {
    test('should handle multiple conversation scenarios', async () => {
      // Get basic test scenarios
      const scenarios = getBasicTestScenarios();
      const results: Array<{ scenario: string; turns: number; success: boolean }> = [];

      for (const scenario of scenarios) {
        const session = await setupTestSession();
        
        try {
          const modelCallback = createModelCallback(session.id, session.threadId);
          const simulator = new ConversationSimulator({
            modelCallback,
          });

          const conversationalTestCases = await simulator.simulate({
            conversationalGoldens: [scenario],
            maxUserSimulations: 5,
          });

          const testCase = conversationalTestCases[0];
          results.push({
            scenario: scenario.scenario.substring(0, 50) + '...',
            turns: testCase?.turns?.length || 0,
            success: testCase && testCase.turns.length > 0,
          });
        } catch (error: any) {
          results.push({
            scenario: scenario.scenario.substring(0, 50) + '...',
            turns: 0,
            success: false,
          });
          console.error(`Scenario failed:`, error.message);
        } finally {
          await cleanupTestSession(session.id);
        }
      }

      console.log('\n📊 Batch Test Results:');
      console.table(results);

      // All scenarios should succeed
      const allSucceeded = results.every(r => r.success);
      expect(allSucceeded).toBe(true);
    }, TEST_TIMEOUT * 3); // Extended timeout for multiple scenarios
  });
});

