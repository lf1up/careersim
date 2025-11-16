/**
 * Simulation-Specific Test Helpers
 * 
 * Provides utilities for loading simulations from the database, creating sessions,
 * running simulation tests, and asserting goal achievement.
 */

import { 
  setupTestSession, 
  TestSession,
  TestSimulation,
} from './helpers';
import {
  SuccessCriteria,
  ConversationGoal,
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
