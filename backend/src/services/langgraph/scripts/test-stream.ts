#!/usr/bin/env ts-node
/**
 * Test Script: Stream LangGraph Execution
 * 
 * This script tests the conversation graph by streaming its execution,
 * showing each node's output as it completes.
 * 
 * Usage:
 *   ts-node src/services/langgraph/scripts/test-stream.ts [--session-id SESSION_ID] [--message MESSAGE]
 *   
 * Or with pnpm:
 *   pnpm debug:graph:stream
 */

import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenvConfig({ path: path.resolve(__dirname, '../../../../.env') });

import 'reflect-metadata';
import { AppDataSource } from '@/config/database';
import { 
  streamConversationGraph,
  type ConversationInput,
} from '../index';

/**
 * Main test function
 */
async function testStream() {
  console.log('🧪 LangGraph Test: Stream Graph Execution\n');
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
    
    // Build test input with actual user ID
    const testSessionId = process.argv.includes('--session-id') 
      ? process.argv[process.argv.indexOf('--session-id') + 1]
      : uuidv4();
    
    const testInput: ConversationInput = {
      sessionId: testSessionId,
      userId: testUser.id,
      userMessage: process.argv.includes('--message')
        ? process.argv[process.argv.indexOf('--message') + 1]
        : 'Can you give me tips for answering behavioral interview questions?',
    };
    
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
    
    // Stream the graph execution
    console.log('\n━'.repeat(60));
    console.log('\n⚙️  Streaming graph execution...\n');
    
    const startTime = Date.now();
    let chunkCount = 0;
    let lastState: any = null;
    
    for await (const chunk of streamConversationGraph(testInput)) {
      chunkCount++;
      lastState = chunk;
      
      // Display chunk information
      const nodeNames = Object.keys(chunk);
      console.log(`\n📦 Chunk ${chunkCount}: ${nodeNames.join(', ')}`);
      
      // Display relevant state updates
      nodeNames.forEach((nodeName) => {
        const nodeState = chunk[nodeName];
        console.log(`  └─ [${nodeName}]`);
        
        // Display key state changes
        if (nodeState.lastUserMessage) {
          console.log(`     User: "${nodeState.lastUserMessage.substring(0, 60)}..."`);
        }
        if (nodeState.lastAiMessage) {
          console.log(`     AI: "${nodeState.lastAiMessage.substring(0, 60)}..."`);
        }
        if (nodeState.ragContext) {
          console.log(`     RAG: Retrieved context`);
        }
        if (nodeState.lastEmotionAnalysis) {
          console.log(`     Emotion: ${nodeState.lastEmotionAnalysis.emotion} (${(nodeState.lastEmotionAnalysis.confidence * 100).toFixed(1)}%)`);
        }
        if (nodeState.lastSentimentAnalysis) {
          console.log(`     Sentiment: ${nodeState.lastSentimentAnalysis.sentiment}`);
        }
        if (nodeState.goalProgress && nodeState.goalProgress.length > 0) {
          const inProgress = nodeState.goalProgress.filter((g: any) => g.status === 'in_progress').length;
          const achieved = nodeState.goalProgress.filter((g: any) => g.status === 'achieved').length;
          console.log(`     Goals: ${achieved} achieved, ${inProgress} in progress`);
        }
      });
      
      console.log('  ─'.repeat(30));
    }
    
    const duration = Date.now() - startTime;
    
    // Display final results
    console.log('\n━'.repeat(60));
    console.log('\n📤 Stream Complete:\n');
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Total Chunks: ${chunkCount}`);
    
    if (lastState) {
      const finalState = lastState[Object.keys(lastState)[0]];
      console.log(`  Final Session ID: ${finalState.sessionId}`);
      console.log(`  Final Message Count: ${finalState.messages?.length || 0}`);
      console.log(`  Final Turn: ${finalState.turn}`);
      console.log(`  Proactive Count: ${finalState.proactiveCount}`);
      
      if (finalState.lastAiMessage) {
        console.log(`\n  💬 Final AI Response:\n`);
        console.log(`     "${finalState.lastAiMessage}"`);
      }
    }
    
    // Success summary
    console.log('\n━'.repeat(60));
    console.log('\n✅ STREAM TEST PASSED!\n');
    console.log('The graph successfully streamed execution and completed.');
    console.log('━'.repeat(60));
    
  } catch (error) {
    console.error('\n❌ STREAM TEST FAILED!\n');
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
testStream().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

