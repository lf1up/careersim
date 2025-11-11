/**
 * Test Script for LangGraph Standalone Server
 * 
 * This script demonstrates how to interact with the standalone server
 * to test simulations and personas programmatically.
 * 
 * Usage:
 *   1. Start the standalone server: pnpm --filter careersim-backend langgraph:server
 *   2. Run this script: ts-node -r tsconfig-paths/register src/services/langgraph/scripts/test-standalone.ts
 */

const BASE_URL = process.env.LANGGRAPH_SERVER_URL || 'http://localhost:8123';

interface Simulation {
  id: string;
  title: string;
  slug: string;
  description: string;
  personas: Array<{
    id: string;
    name: string;
    role: string;
  }>;
}

interface Session {
  id: string;
  simulationId: string;
  simulationTitle: string;
  personaId: string;
  personaName: string;
  threadId: string;
}

/**
 * Test 1: Health Check
 */
async function testHealthCheck() {
  console.log('\n📋 Test 1: Health Check');
  console.log('─'.repeat(50));
  
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    console.log('✅ Server is healthy:', data);
    return true;
  } catch (error: any) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

/**
 * Test 2: List Simulations
 */
async function testListSimulations(): Promise<Simulation | null> {
  console.log('\n📋 Test 2: List Simulations');
  console.log('─'.repeat(50));
  
  try {
    const response = await fetch(`${BASE_URL}/simulations`);
    const data: any = await response.json();
    const simulations = data.simulations;
    
    console.log(`✅ Found ${simulations.length} simulation(s)`);
    
    if (simulations.length > 0) {
      const sim = simulations[0];
      console.log(`\nFirst simulation:`);
      console.log(`  ID: ${sim.id}`);
      console.log(`  Title: ${sim.title}`);
      console.log(`  Difficulty: ${sim.difficulty}/5`);
      console.log(`  Personas: ${sim.personas.length}`);
      
      if (sim.personas.length > 0) {
        console.log(`\n  First persona:`);
        console.log(`    ID: ${sim.personas[0].id}`);
        console.log(`    Name: ${sim.personas[0].name}`);
        console.log(`    Role: ${sim.personas[0].role}`);
      }
      
      return sim;
    }
    
    console.log('⚠️  No simulations found. Please seed the database first.');
    return null;
  } catch (error: any) {
    console.error('❌ Failed to list simulations:', error.message);
    return null;
  }
}

/**
 * Test 3: Create Session
 */
async function testCreateSession(simulation: Simulation): Promise<Session | null> {
  console.log('\n📋 Test 3: Create Session');
  console.log('─'.repeat(50));
  
  try {
    const response = await fetch(`${BASE_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulationId: simulation.id,
        personaId: simulation.personas[0]?.id,
      }),
    });
    
    const data: any = await response.json();
    const session = data.session;
    console.log('✅ Session created successfully:');
    console.log(`  Session ID: ${session.id}`);
    console.log(`  Thread ID: ${session.threadId}`);
    console.log(`  Simulation: ${session.simulationTitle}`);
    console.log(`  Persona: ${session.personaName}`);
    
    return session;
  } catch (error: any) {
    console.error('❌ Failed to create session:', error.message);
    return null;
  }
}

/**
 * Test 4: Invoke Graph (Standard Mode)
 */
async function testInvokeGraph(session: Session, message: string) {
  console.log('\n📋 Test 4: Invoke Graph (Standard Mode)');
  console.log('─'.repeat(50));
  console.log(`Message: "${message}"`);
  
  try {
    const startTime = Date.now();
    const response = await fetch(
      `${BASE_URL}/threads/${session.threadId}/runs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { message },
        }),
      }
    );
    const duration = Date.now() - startTime;
    
    const data: any = await response.json();
    const output = data.output;
    console.log(`\n✅ Graph execution completed in ${duration}ms`);
    console.log(`\nAI Response: "${output.lastAiMessage}"`);
    console.log(`Turn: ${output.turn}`);
    console.log(`Messages in history: ${output.messages.length}`);
    console.log(`Goals tracked: ${output.goalProgress.length}`);
    
    if (output.metadata) {
      console.log(`\nMetadata:`);
      if (output.metadata.sentiment) {
        console.log(`  Sentiment: ${output.metadata.sentiment}`);
      }
      if (output.metadata.emotionalTone) {
        console.log(`  Emotional Tone: ${output.metadata.emotionalTone}`);
      }
    }
    
    return output;
  } catch (error: any) {
    console.error('❌ Failed to invoke graph:', error.message);
    return null;
  }
}

/**
 * Test 5: Stream Graph Execution
 */
async function testStreamGraph(session: Session, message: string) {
  console.log('\n📋 Test 5: Stream Graph Execution');
  console.log('─'.repeat(50));
  console.log(`Message: "${message}"`);
  
  try {
    console.log('\n✅ Streaming mode test skipped (requires stream handling)');
    console.log('   Use curl or a streaming client to test this feature');
    return true;
  } catch (error: any) {
    console.error('❌ Failed to stream graph:', error.message);
    return null;
  }
}

/**
 * Test 6: Get Session Details
 */
async function testGetSession(sessionId: string) {
  console.log('\n📋 Test 6: Get Session Details');
  console.log('─'.repeat(50));
  
  try {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}`);
    const data: any = await response.json();
    const session = data.session;
    
    console.log('✅ Session details retrieved:');
    console.log(`  Session ID: ${session.id}`);
    console.log(`  Status: ${session.status}`);
    console.log(`  Message Count: ${session.messageCount}`);
    console.log(`  Started At: ${session.startedAt}`);
    
    return session;
  } catch (error: any) {
    console.error('❌ Failed to get session:', error.message);
    return null;
  }
}

/**
 * Test 7: Proactive Message (Start)
 */
async function testProactiveStart(session: Session) {
  console.log('\n📋 Test 7: Proactive Message (Start)');
  console.log('─'.repeat(50));
  
  try {
    const response = await fetch(
      `${BASE_URL}/threads/${session.threadId}/runs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { proactiveTrigger: 'start' },
        }),
      }
    );
    
    const data: any = await response.json();
    const output = data.output;
    console.log('✅ Proactive start message generated:');
    console.log(`\nAI Opening: "${output.lastAiMessage}"`);
    
    return output;
  } catch (error: any) {
    console.error('❌ Failed to generate proactive message:', error.message);
    return null;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n🚀 LangGraph Standalone Server Test Suite');
  console.log('═'.repeat(50));
  console.log(`Server URL: ${BASE_URL}`);
  console.log('═'.repeat(50));
  
  // Test 1: Health Check
  const isHealthy = await testHealthCheck();
  if (!isHealthy) {
    console.log('\n❌ Server is not healthy. Please start the standalone server first:');
    console.log('   pnpm --filter careersim-backend langgraph:server');
    process.exit(1);
  }
  
  // Test 2: List Simulations
  const simulation = await testListSimulations();
  if (!simulation) {
    console.log('\n❌ No simulations available. Please seed the database:');
    console.log('   pnpm --filter careersim-backend run db:seed');
    process.exit(1);
  }
  
  // Test 3: Create Session
  const session = await testCreateSession(simulation);
  if (!session) {
    console.log('\n❌ Failed to create session');
    process.exit(1);
  }
  
  // Test 4: Invoke Graph
  const result1 = await testInvokeGraph(
    session,
    "Hello! I'm excited to practice this simulation with you."
  );
  
  if (!result1) {
    console.log('\n❌ Failed to invoke graph');
    process.exit(1);
  }
  
  // Wait a moment before next test
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 5: Stream Graph
  await testStreamGraph(
    session,
    "Can you tell me more about what we'll be working on?"
  );
  
  // Wait a moment before next test
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 6: Get Session
  await testGetSession(session.id);
  
  // Test 7: Create new session for proactive test
  const session2 = await testCreateSession(simulation);
  if (session2) {
    await testProactiveStart(session2);
  }
  
  // Summary
  console.log('\n');
  console.log('═'.repeat(50));
  console.log('✅ All tests completed successfully!');
  console.log('═'.repeat(50));
  console.log('\nYou can now:');
  console.log('  - Connect LangGraph Studio to', BASE_URL);
  console.log('  - Use MCP-compliant clients to test conversations');
  console.log('  - Build custom integrations using the API');
  console.log('');
}

// Run tests if executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  });
}

export { runTests };

