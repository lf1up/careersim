/**
 * Standalone Server Utilities
 * 
 * Helper functions for managing sessions, simulations, and personas
 * in the standalone LangGraph server environment
 */

import { AppDataSource } from '@/config/database';
import { Simulation } from '@/entities/Simulation';
import { Persona } from '@/entities/Persona';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { User } from '@/entities/User';

/**
 * Initialize database connection
 */
export async function initializeDatabase(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
    console.log('✅ Database connection established');
  }
}

/**
 * List all active simulations with their personas
 */
export async function listSimulations() {
  const simulationRepo = AppDataSource.getRepository(Simulation);
  
  const simulations = await simulationRepo.find({
    where: { isPublic: true },
    relations: ['personas', 'category'],
    order: { sortOrder: 'ASC', title: 'ASC' },
  });

  return simulations.map(sim => ({
    id: sim.id,
    title: sim.title,
    slug: sim.slug,
    description: sim.description,
    scenario: sim.scenario,
    objectives: sim.objectives,
    difficulty: sim.difficulty,
    category: sim.category?.name || 'Uncategorized',
    personas: sim.personas?.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      personality: p.personality,
      difficultyLevel: p.difficultyLevel,
      category: p.category,
    })) || [],
  }));
}

/**
 * Get or create a test user for standalone server
 */
async function getOrCreateTestUser(userId?: string): Promise<User> {
  const userRepo = AppDataSource.getRepository(User);
  
  if (userId) {
    const existingUser = await userRepo.findOne({ where: { id: userId } });
    if (existingUser) {
      return existingUser;
    }
  }
  
  // Try to find an existing test user
  let testUser = await userRepo.findOne({ 
    where: { email: 'test@langgraph.local' } 
  });
  
  if (!testUser) {
    // Create a test user for standalone server
    testUser = userRepo.create({
      email: 'test@langgraph.local',
      password: 'not-used', // Won't be used for authentication
      firstName: 'LangGraph',
      lastName: 'Test',
      isActive: true,
    });
    await userRepo.save(testUser);
    console.log('✅ Created test user for standalone server');
  }
  
  return testUser;
}

/**
 * Create a new simulation session
 */
export async function createSession(
  simulationId: string,
  personaId?: string,
  userId?: string,
): Promise<SimulationSession> {
  const simulationRepo = AppDataSource.getRepository(Simulation);
  const sessionRepo = AppDataSource.getRepository(SimulationSession);
  
  // Load simulation with personas
  const simulation = await simulationRepo.findOne({
    where: { id: simulationId },
    relations: ['personas'],
  });
  
  if (!simulation) {
    throw new Error(`Simulation ${simulationId} not found`);
  }
  
  // Verify persona if specified, otherwise use first one
  let selectedPersona: Persona;
  if (personaId) {
    selectedPersona = simulation.personas?.find(p => p.id === personaId) as Persona;
    if (!selectedPersona) {
      throw new Error(`Persona ${personaId} not found in simulation ${simulationId}`);
    }
  } else {
    if (!simulation.personas || simulation.personas.length === 0) {
      throw new Error(`No personas available for simulation ${simulationId}`);
    }
    selectedPersona = simulation.personas[0];
  }
  
  // Get or create user
  const user = await getOrCreateTestUser(userId);
  
  // Create session
  const session = sessionRepo.create({
    simulation,
    user,
    status: SessionStatus.IN_PROGRESS,
    startedAt: new Date(),
    messageCount: 0,
    turn: 'ai', // AI can start the conversation
    aiInitiated: false,
    goalProgress: [],
    inactivityNudgeCount: 0,
  });
  
  await sessionRepo.save(session);
  
  // Reload with relations
  const savedSession = await sessionRepo.findOne({
    where: { id: session.id },
    relations: ['simulation', 'simulation.personas', 'user'],
  });
  
  console.log(`✅ Created session ${session.id} for simulation "${simulation.title}" with persona "${selectedPersona.name}"`);
  
  return savedSession!;
}

/**
 * Get session by ID with all necessary relations
 */
export async function getSessionById(sessionId: string): Promise<SimulationSession | null> {
  const sessionRepo = AppDataSource.getRepository(SimulationSession);
  
  const session = await sessionRepo.findOne({
    where: { id: sessionId },
    relations: ['simulation', 'simulation.personas', 'user'],
  });
  
  return session;
}

/**
 * List sessions for a user
 */
export async function listSessions(userId?: string): Promise<SimulationSession[]> {
  const sessionRepo = AppDataSource.getRepository(SimulationSession);
  
  let query = sessionRepo.createQueryBuilder('session')
    .leftJoinAndSelect('session.simulation', 'simulation')
    .leftJoinAndSelect('simulation.personas', 'personas')
    .leftJoinAndSelect('session.user', 'user')
    .orderBy('session.startedAt', 'DESC');
  
  if (userId) {
    query = query.where('user.id = :userId', { userId });
  }
  
  const sessions = await query.getMany();
  return sessions;
}

/**
 * Convert session ID to LangGraph thread configuration
 */
export function sessionToThreadConfig(sessionId: string) {
  return {
    configurable: {
      thread_id: sessionId,
    },
  };
}

