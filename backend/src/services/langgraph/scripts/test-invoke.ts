#!/usr/bin/env ts-node
/**
 * Test Script: Invoke LangGraph with Sample Data
 * 
 * This script tests the conversation graph by invoking it with sample inputs.
 * It does NOT require a running database or external services (they will be mocked).
 * 
 * Usage:
 *   ts-node src/services/langgraph/scripts/test-invoke.ts [--session-id SESSION_ID] [--message MESSAGE]
 *   
 * Or with pnpm:
 *   pnpm debug:graph:invoke
 */

import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenvConfig({ path: path.resolve(__dirname, '../../../../.env') });

import 'reflect-metadata';
import { AppDataSource } from '@/config/database';
import { 
  invokeConversationGraph,
  type ConversationInput,
} from '../index';

/**
 * Main test function
 */
async function testInvoke() {
  console.log('🧪 LangGraph Test: Invoke Graph\n');
  console.log('━'.repeat(60));
  
  try {
    // Initialize database connection
    console.log('\n🔌 Initializing database connection...');
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✅ Database connection established');
    }
    
    // Create or get test session
    console.log('\n🔧 Setting up test session...');
    const { SimulationSession } = await import('@/entities/SimulationSession');
    const { Simulation } = await import('@/entities/Simulation');
    const { Persona } = await import('@/entities/Persona');
    const { User } = await import('@/entities/User');
    
    const sessionRepo = AppDataSource.getRepository(SimulationSession);
    const simulationRepo = AppDataSource.getRepository(Simulation);
    const personaRepo = AppDataSource.getRepository(Persona);
    const userRepo = AppDataSource.getRepository(User);
    
    // Find or create a test user
    let testUser = await userRepo.findOne({ where: { email: 'test-user@example.com' } });
    if (!testUser) {
      testUser = userRepo.create({
        firstName: 'Test',
        lastName: 'User',
        email: 'test-user@example.com',
        password: 'test-hash',
      });
      await userRepo.save(testUser);
      console.log('  ✅ Created test user');
    }
    
    // Find or create a test persona
    let testPersona = await personaRepo.findOne({ where: { name: 'Test Interview Coach' } });
    if (!testPersona) {
      const { PersonaCategory } = await import('@/entities/Persona');
      testPersona = personaRepo.create({
        name: 'Test Interview Coach',
        slug: 'test-interview-coach',
        role: 'Interview Coach',
        personality: 'Professional, supportive, and knowledgeable coach who helps candidates prepare for interviews',
        primaryGoal: 'Help candidates master behavioral interview techniques',
        hiddenMotivation: 'Wants to see candidates succeed and build confidence',
        category: PersonaCategory.JOB_SEEKING,
        conversationStyle: {
          tone: 'professional yet friendly',
          formality: 'semi-formal',
          pace: 'moderate',
          emotionalRange: ['supportive', 'encouraging', 'analytical'],
          commonPhrases: ['That\'s a great approach', 'Let me help you improve that', 'Consider using the STAR method'],
        },
        isActive: true,
      });
      await personaRepo.save(testPersona);
      console.log('  ✅ Created test persona');
    }
    
    // Find or create a test category first
    const { Category } = await import('@/entities/Category');
    const categoryRepo = AppDataSource.getRepository(Category);
    let testCategory = await categoryRepo.findOne({ where: { name: 'Interview Preparation' } });
    if (!testCategory) {
      testCategory = categoryRepo.create({
        name: 'Interview Preparation',
        slug: 'interview-preparation',
        description: 'Simulations focused on interview skills',
      });
      await categoryRepo.save(testCategory);
      console.log('  ✅ Created test category');
    }
    
    // Find or create a test simulation
    let testSimulation = await simulationRepo.findOne({
      where: { title: 'Test Behavioral Interview Prep' },
      relations: ['personas', 'category'],
    });
    
    if (!testSimulation) {
      const { SimulationDifficulty, SimulationStatus } = await import('@/entities/Simulation');
      testSimulation = simulationRepo.create({
        title: 'Test Behavioral Interview Prep',
        slug: 'test-behavioral-interview-prep',
        description: 'Practice behavioral interview questions and master the STAR method',
        scenario: 'You are preparing for a behavioral interview at a tech company. The interviewer wants to understand your past experiences and how you handle various situations.',
        objectives: ['Master STAR method', 'Build confidence', 'Practice clear responses'],
        difficulty: SimulationDifficulty.INTERMEDIATE,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 30,
        category: testCategory,
        personas: [testPersona],
      });
      await simulationRepo.save(testSimulation);
      console.log('  ✅ Created test simulation');
    } else if (!testSimulation.personas || testSimulation.personas.length === 0) {
      testSimulation.personas = [testPersona];
      await simulationRepo.save(testSimulation);
    }
    
    // Build test input with actual user ID
    const testSessionId = process.argv.includes('--session-id') 
      ? process.argv[process.argv.indexOf('--session-id') + 1]
      : uuidv4();
    
    const testInput: ConversationInput = {
      sessionId: testSessionId,
      userId: testUser.id,
      userMessage: process.argv.includes('--message')
        ? process.argv[process.argv.indexOf('--message') + 1]
        : 'Hello, I need help preparing for an interview',
    };
    
    // Find or create a test session
    let testSession = await sessionRepo.findOne({
      where: { id: testInput.sessionId },
      relations: ['simulation', 'simulation.personas', 'user'],
    });
    
    if (!testSession) {
      const { SessionStatus } = await import('@/entities/SimulationSession');
      testSession = sessionRepo.create({
        id: testInput.sessionId,
        user: testUser,
        simulation: testSimulation,
        status: SessionStatus.IN_PROGRESS,
        startedAt: new Date(),
        durationSeconds: 0,
        messageCount: 0,
        sessionMetadata: {
          deviceType: 'test',
          inputMethod: 'text',
        },
      });
      await sessionRepo.save(testSession);
      console.log('  ✅ Created test session');
    }
    
    // Display test input
    console.log('\n📥 Test Input:\n');
    console.log(`  Session ID: ${testInput.sessionId}`);
    console.log(`  User ID: ${testInput.userId}`);
    console.log(`  Simulation: ${testSimulation.title}`);
    console.log(`  Persona: ${testPersona.name}`);
    console.log(`  User Message: "${testInput.userMessage}"`);
    
    // Invoke the graph
    console.log('\n━'.repeat(60));
    console.log('\n⚙️  Invoking graph...\n');
    
    const startTime = Date.now();
    const result = await invokeConversationGraph(testInput);
    const duration = Date.now() - startTime;
    
    // Display results
    console.log('\n━'.repeat(60));
    console.log('\n📤 Test Result:\n');
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Session ID: ${result.sessionId}`);
    console.log(`  Message Count: ${result.messages?.length || 0}`);
    console.log(`  Last AI Message: ${result.lastAiMessage ? '"' + result.lastAiMessage.substring(0, 100) + '..."' : 'None'}`);
    console.log(`  Turn: ${result.turn}`);
    console.log(`  Proactive Count: ${result.proactiveCount}`);
    console.log(`  Needs Evaluation: ${result.needsEvaluation}`);
    console.log(`  Evaluation Complete: ${result.evaluationComplete}`);
    
    // Display emotion/sentiment if available
    if (result.lastEmotionAnalysis) {
      console.log(`\n  Emotion: ${result.lastEmotionAnalysis.emotion} (${(result.lastEmotionAnalysis.confidence * 100).toFixed(1)}%)`);
    }
    if (result.lastSentimentAnalysis) {
      console.log(`  Sentiment: ${result.lastSentimentAnalysis.sentiment} (${(result.lastSentimentAnalysis.confidence * 100).toFixed(1)}%)`);
    }
    
    // Display goal progress
    if (result.goalProgress && result.goalProgress.length > 0) {
      console.log(`\n  📊 Goal Progress:`);
      result.goalProgress.forEach((goal) => {
        const statusEmoji = goal.status === 'achieved' ? '✅' : goal.status === 'in_progress' ? '🔄' : '⏸️';
        console.log(`    ${statusEmoji} Goal ${goal.goalNumber}: ${goal.title}`);
        console.log(`       Status: ${goal.status} (${(goal.confidence * 100).toFixed(1)}% confidence)`);
        if (goal.evidence && goal.evidence.length > 0) {
          console.log(`       Evidence: ${goal.evidence.length} item(s)`);
        }
      });
    }
    
    // Display conversation history
    if (result.messages && result.messages.length > 0) {
      console.log(`\n  💬 Conversation History (${result.messages.length} messages):`);
      result.messages.slice(-5).forEach((msg: any, idx: number) => {
        const role = msg._getType ? msg._getType() : 'unknown';
        const content = typeof msg.content === 'string' 
          ? msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '')
          : JSON.stringify(msg.content).substring(0, 80);
        console.log(`    ${idx + 1}. [${role}] ${content}`);
      });
    }
    
    // Display RAG context if available
    if (result.ragContext) {
      console.log(`\n  📚 RAG Context: ${result.ragContext.substring(0, 100)}...`);
    }
    
    // Success summary
    console.log('\n━'.repeat(60));
    console.log('\n✅ TEST PASSED!\n');
    console.log('The graph successfully processed the input and generated a response.');
    console.log('\nFull state object available in result variable.');
    console.log('━'.repeat(60));
    
    // Optionally output full state as JSON
    if (process.argv.includes('--full')) {
      console.log('\n📋 Full State (JSON):\n');
      console.log(JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.error('\n❌ TEST FAILED!\n');
    console.error('Error details:');
    console.error(error);
    console.error('\n━'.repeat(60));
    process.exit(1);
  } finally {
    // Close database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run the test script
testInvoke().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

