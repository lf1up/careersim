#!/usr/bin/env ts-node
/**
 * Test Script: Test Proactive Messages
 * 
 * This script tests the proactive message generation capabilities of the graph.
 * 
 * Usage:
 *   ts-node src/services/langgraph/scripts/test-proactive.ts [--type start|inactivity|followup|backchannel]
 *   
 * Or with pnpm:
 *   pnpm debug:graph:proactive
 */

import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenvConfig({ path: path.resolve(__dirname, '../../../../.env') });

import 'reflect-metadata';
import { AppDataSource } from '@/config/database';
import { 
  invokeConversationGraph,
  type ConversationInput,
  type ProactiveTrigger,
} from '../index';

/**
 * Get proactive trigger type from command line
 */
function getProactiveTrigger(): ProactiveTrigger {
  const typeIndex = process.argv.indexOf('--type');
  if (typeIndex !== -1 && process.argv[typeIndex + 1]) {
    const type = process.argv[typeIndex + 1] as ProactiveTrigger;
    if (['start', 'inactivity', 'followup', 'backchannel'].includes(type)) {
      return type;
    }
  }
  return 'start'; // Default to start message
}

/**
 * Main test function
 */
async function testProactive() {
  const proactiveTrigger = getProactiveTrigger();
  
  console.log('🧪 LangGraph Test: Proactive Messages\n');
  console.log('━'.repeat(60));
  
  try {
    // Initialize database connection
    console.log('\n🔌 Initializing database connection...');
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✅ Database connection established');
    }
    
    // Create or get test session data (reuse from other tests)
    console.log('\n🔧 Setting up test session...');
    const { SimulationSession } = await import('@/entities/SimulationSession');
    const { Simulation } = await import('@/entities/Simulation');
    const { Persona } = await import('@/entities/Persona');
    const { User } = await import('@/entities/User');
    const { Category } = await import('@/entities/Category');
    
    const sessionRepo = AppDataSource.getRepository(SimulationSession);
    const simulationRepo = AppDataSource.getRepository(Simulation);
    const personaRepo = AppDataSource.getRepository(Persona);
    const userRepo = AppDataSource.getRepository(User);
    const categoryRepo = AppDataSource.getRepository(Category);
    
    // Find or create test user
    let testUser = await userRepo.findOne({ where: { email: 'test-user@example.com' } });
    if (!testUser) {
      testUser = userRepo.create({
        firstName: 'Test',
        lastName: 'User',
        email: 'test-user@example.com',
        password: 'test-hash',
      });
      await userRepo.save(testUser);
    }
    
    // Find or create test persona  
    let testPersona = await personaRepo.findOne({ where: { name: 'Test Interview Coach' } });
    if (!testPersona) {
      const { PersonaCategory } = await import('@/entities/Persona');
      testPersona = personaRepo.create({
        name: 'Test Interview Coach',
        slug: 'test-interview-coach',
        role: 'Interview Coach',
        personality: 'Professional, supportive, and knowledgeable coach',
        primaryGoal: 'Help candidates master interview techniques',
        hiddenMotivation: 'Wants to see candidates succeed',
        category: PersonaCategory.JOB_SEEKING,
        conversationStyle: {
          tone: 'professional yet friendly',
          formality: 'semi-formal',
          pace: 'moderate',
        },
        isActive: true,
      });
      await personaRepo.save(testPersona);
    }
    
    // Find or create test category
    let testCategory = await categoryRepo.findOne({ where: { name: 'Interview Preparation' } });
    if (!testCategory) {
      testCategory = categoryRepo.create({
        name: 'Interview Preparation',
        slug: 'interview-preparation',
        description: 'Simulations focused on interview skills',
      });
      await categoryRepo.save(testCategory);
    }
    
    // Find or create test simulation
    let testSimulation = await simulationRepo.findOne({
      where: { title: 'Test Behavioral Interview Prep' },
      relations: ['personas', 'category'],
    });
    
    if (!testSimulation) {
      const { SimulationDifficulty, SimulationStatus } = await import('@/entities/Simulation');
      testSimulation = simulationRepo.create({
        title: 'Test Behavioral Interview Prep',
        slug: 'test-behavioral-interview-prep',
        description: 'Practice behavioral interview questions',
        scenario: 'You are preparing for a behavioral interview',
        objectives: ['Master STAR method', 'Build confidence'],
        difficulty: SimulationDifficulty.INTERMEDIATE,
        status: SimulationStatus.PUBLISHED,
        estimatedDurationMinutes: 30,
        category: testCategory,
        personas: [testPersona],
      });
      await simulationRepo.save(testSimulation);
    } else if (!testSimulation.personas || testSimulation.personas.length === 0) {
      testSimulation.personas = [testPersona];
      await simulationRepo.save(testSimulation);
    }
    
    // Display test configuration
    console.log('\n⚙️  Test Configuration:\n');
    console.log(`  Proactive Type: ${proactiveTrigger}`);
    
    const sessionId = uuidv4();
    console.log(`  Session ID: ${sessionId}`);
    console.log(`  User ID: ${testUser.id}`);
    
    // Create test session
    const { SessionStatus } = await import('@/entities/SimulationSession');
    const testSession = sessionRepo.create({
      id: sessionId,
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
    
    // Prepare input based on proactive type
    const testInput: ConversationInput = {
      sessionId,
      userId: testUser.id,
      proactiveTrigger,
    };
    
    // Add context message for certain types
    if (proactiveTrigger === 'inactivity' || proactiveTrigger === 'followup' || proactiveTrigger === 'backchannel') {
      // First, send a user message to establish context
      console.log('\n━'.repeat(60));
      console.log('\n📤 Step 1: Sending initial user message...\n');
      
      const contextInput: ConversationInput = {
        sessionId,
        userId: testUser.id,
        userMessage: 'I need help preparing for a job interview.',
      };
      
      await invokeConversationGraph(contextInput);
      console.log('✅ Context established');
      
      // Wait a bit to simulate inactivity
      if (proactiveTrigger === 'inactivity') {
        console.log('\n⏳ Simulating inactivity (2 seconds)...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Invoke the graph with proactive trigger
    console.log('\n━'.repeat(60));
    console.log(`\n⚙️  Step 2: Triggering ${proactiveTrigger} message...\n`);
    
    const startTime = Date.now();
    const result = await invokeConversationGraph(testInput);
    const duration = Date.now() - startTime;
    
    // Display results
    console.log('\n━'.repeat(60));
    console.log('\n📤 Test Result:\n');
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Proactive Type: ${result.proactiveTrigger}`);
    console.log(`  Proactive Count: ${result.proactiveCount}`);
    console.log(`  Message Count: ${result.messages?.length || 0}`);
    
    if (result.lastAiMessage) {
      console.log(`\n  💬 Proactive Message:\n`);
      console.log(`  ┌${'─'.repeat(58)}┐`);
      
      // Wrap text to fit within box
      const words = result.lastAiMessage.split(' ');
      let line = '  │ ';
      words.forEach((word) => {
        if (line.length + word.length > 58) {
          console.log(line + ' '.repeat(60 - line.length) + '│');
          line = '  │ ' + word + ' ';
        } else {
          line += word + ' ';
        }
      });
      if (line.length > 4) {
        console.log(line + ' '.repeat(60 - line.length) + '│');
      }
      
      console.log(`  └${'─'.repeat(58)}┘`);
    }
    
    // Display message characteristics
    console.log('\n  📊 Message Characteristics:');
    
    if (result.lastEmotionAnalysis) {
      console.log(`    Emotion: ${result.lastEmotionAnalysis.emotion} (${(result.lastEmotionAnalysis.confidence * 100).toFixed(1)}%)`);
    }
    if (result.lastSentimentAnalysis) {
      console.log(`    Sentiment: ${result.lastSentimentAnalysis.sentiment} (${(result.lastSentimentAnalysis.confidence * 100).toFixed(1)}%)`);
    }
    if (result.lastQualityScores) {
      console.log(`    Quality Score: ${result.lastQualityScores.overall?.toFixed(2) || 'N/A'}`);
    }
    
    // Display metadata
    if (result.metadata) {
      console.log('\n  📋 Metadata:');
      if (result.metadata.lastAiMessageAt) {
        console.log(`    Last AI Message: ${new Date(result.metadata.lastAiMessageAt).toISOString()}`);
      }
      if (result.metadata.inactivityNudgeCount !== undefined) {
        console.log(`    Inactivity Nudge Count: ${result.metadata.inactivityNudgeCount}`);
      }
    }
    
    // Success summary
    console.log('\n━'.repeat(60));
    console.log('\n✅ PROACTIVE TEST PASSED!\n');
    console.log(`The graph successfully generated a ${proactiveTrigger} message.`);
    console.log('\nYou can test other types with:');
    console.log('  --type start        (initial greeting)');
    console.log('  --type inactivity   (nudge after silence)');
    console.log('  --type followup     (continue conversation)');
    console.log('  --type backchannel  (acknowledgment)');
    console.log('━'.repeat(60));
    
  } catch (error) {
    console.error('\n❌ PROACTIVE TEST FAILED!\n');
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
testProactive().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

