/**
 * Test Helpers for LangGraph DeepEval Integration
 * 
 * Provides utilities for testing the LangGraph conversation system
 * with DeepEval's conversation simulator
 */

import { ChildProcess, spawn } from 'child_process';
import { Turn } from 'deepeval-ts';

const BASE_URL = process.env.LANGGRAPH_SERVER_URL || 'http://localhost:8123';
const SERVER_START_TIMEOUT = 30000; // 30 seconds

/**
 * Types for API responses
 */
export interface TestSimulation {
  id: string;
  title: string;
  slug: string;
  description: string;
  scenario: string;
  objectives: string[];
  difficulty: number;
  conversationGoals?: Array<{
    goalNumber: number;
    isOptional?: boolean;
    title: string;
    description: string;
  }>;
  personas: Array<{
    id: string;
    name: string;
    role: string;
    personality: string;
    difficultyLevel: number;
    category: string;
  }>;
}

export interface TestSession {
  id: string;
  threadId: string;
  simulationId: string;
  simulationTitle: string;
  personaId: string;
  personaName: string;
  status: string;
  messageCount: number;
}

export interface ConversationOutput {
  sessionId: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  lastAiMessage?: string;
  goalProgress: Array<{
    goalNumber: number;
    title: string;
    status: 'not_started' | 'in_progress' | 'achieved';
    confidence: number;
  }>;
  turn: 'user' | 'ai';
  metadata: {
    sentiment?: string;
    emotionalTone?: string;
    confidence?: number;
    processingTime?: number;
    [key: string]: any;
  };
}

/**
 * Server management
 */
let serverProcess: ChildProcess | null = null;

/**
 * Start the standalone LangGraph server for testing
 */
export async function startStandaloneServer(): Promise<void> {
  // Check if server is already running
  try {
    const response = await fetch(`${BASE_URL}/health`);
    if (response.ok) {
      console.log('✅ Standalone server already running');
      return;
    }
  } catch {
    // Server not running, need to start it
  }

  console.log('🚀 Starting standalone LangGraph server...');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill();
      }
      reject(new Error('Server startup timeout'));
    }, SERVER_START_TIMEOUT);

    // Start the server process
    serverProcess = spawn('pnpm', ['--filter', 'careersim-backend', 'langgraph:server'], {
      cwd: process.cwd(),
      stdio: 'pipe',
      detached: false,
    });

    let output = '';

    serverProcess.stdout?.on('data', (data) => {
      output += data.toString();
      // Look for successful startup message
      if (output.includes('LangGraph Standalone Server is running')) {
        clearTimeout(timeout);
        console.log('✅ Standalone server started successfully');
        resolve();
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error('Server error:', data.toString());
    });

    serverProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

/**
 * Stop the standalone server
 */
export async function stopStandaloneServer(): Promise<void> {
  if (serverProcess) {
    console.log('🛑 Stopping standalone server...');
    serverProcess.kill('SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise<void>((resolve) => {
      if (serverProcess) {
        serverProcess.on('exit', () => {
          console.log('✅ Server stopped');
          serverProcess = null;
          resolve();
        });
        
        // Force kill after 5 seconds
        setTimeout(() => {
          if (serverProcess) {
            serverProcess.kill('SIGKILL');
            serverProcess = null;
          }
          resolve();
        }, 5000);
      } else {
        resolve();
      }
    });
  }
}

/**
 * Wait for server to be ready
 */
export async function waitForServer(maxAttempts = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error('Server did not become ready in time');
}

/**
 * Get first available simulation
 */
export async function getFirstSimulation(): Promise<TestSimulation> {
  const response = await fetch(`${BASE_URL}/simulations`);
  if (!response.ok) {
    throw new Error(`Failed to fetch simulations: ${response.statusText}`);
  }
  
  const data = await response.json() as { simulations: TestSimulation[] };
  const simulations = data.simulations;
  
  if (simulations.length === 0) {
    throw new Error('No simulations available. Please seed the database first.');
  }
  
  return simulations[0];
}

/**
 * Setup a test session
 */
export async function setupTestSession(
  simulationId?: string,
  personaId?: string
): Promise<TestSession> {
  // Get a simulation if not provided
  if (!simulationId) {
    const simulation = await getFirstSimulation();
    simulationId = simulation.id;
    personaId = personaId || simulation.personas[0]?.id;
  }
  
  const response = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulationId,
      personaId,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.statusText}`);
  }
  
  const data = await response.json() as { session: TestSession };
  return data.session;
}

/**
 * Cleanup test session (optional - database rollback can handle this)
 */
export async function cleanupTestSession(sessionId: string): Promise<void> {
  // Session cleanup could be implemented here if needed
  // For now, we rely on test database cleanup/rollback
  console.log(`🧹 Test session ${sessionId} will be cleaned up by database rollback`);
}

/**
 * Create model callback for DeepEval
 * This wraps the standalone server API to match DeepEval's expected interface
 */
export function createModelCallback(sessionId: string, threadId: string) {
  return async (args: { input: string; turns: Turn[]; threadId: string }): Promise<Turn> => {
    try {
      // Use the provided threadId (sessionId)
      const response = await fetch(`${BASE_URL}/threads/${threadId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            message: args.input,
          },
        }),
      });
      
      if (!response.ok) {
        throw new Error(`API call failed: ${response.statusText}`);
      }
      
      const data = await response.json() as { output: ConversationOutput };
      const output = data.output;
      
      // Return the AI's response as a Turn
      return new Turn({
        role: 'assistant',
        content: output.lastAiMessage || 'No response generated',
      });
    } catch (error: any) {
      console.error('Model callback error:', error);
      throw new Error(`Failed to get AI response: ${error.message}`);
    }
  };
}

/**
 * Invoke the graph directly (for non-DeepEval tests)
 */
export async function invokeGraph(
  threadId: string,
  message: string
): Promise<ConversationOutput> {
  const response = await fetch(`${BASE_URL}/threads/${threadId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { message },
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Graph invocation failed: ${response.statusText}`);
  }
  
  const data = await response.json() as { output: ConversationOutput };
  return data.output;
}

/**
 * Invoke with proactive trigger
 */
export async function invokeGraphWithTrigger(
  threadId: string,
  trigger: 'start' | 'inactivity' | 'followup' | 'backchannel'
): Promise<ConversationOutput> {
  const response = await fetch(`${BASE_URL}/threads/${threadId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { proactiveTrigger: trigger },
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Graph invocation failed: ${response.statusText}`);
  }
  
  const data = await response.json() as { output: ConversationOutput };
  return data.output;
}

/**
 * Get session details
 */
export async function getSessionDetails(sessionId: string): Promise<any> {
  const response = await fetch(`${BASE_URL}/sessions/${sessionId}`);
  
  if (!response.ok) {
    throw new Error(`Failed to get session: ${response.statusText}`);
  }
  
  const data = await response.json() as { session: any };
  return data.session;
}

/**
 * Test helper to check if database is seeded
 */
export async function isDatabaseSeeded(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/simulations`);
    if (!response.ok) return false;
    
    const data = await response.json() as { simulations: TestSimulation[] };
    return data.simulations && data.simulations.length > 0;
  } catch {
    return false;
  }
}

