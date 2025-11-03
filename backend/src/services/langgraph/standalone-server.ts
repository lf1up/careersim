/**
 * LangGraph Standalone Server
 * 
 * A standalone server for testing LangGraph conversations with simulations and personas.
 * Compatible with LangGraph Studio and MCP-compliant clients.
 * 
 * Usage:
 *   pnpm --filter careersim-backend langgraph:server
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { 
  initializeDatabase, 
  listSimulations, 
  createSession, 
  getSessionById,
  listSessions,
  sessionToThreadConfig,
} from './standalone-utils';
import { 
  getConversationGraph, 
  invokeConversationGraph,
  streamConversationGraph,
} from './graph';
import { ConversationInput } from './state';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.LANGGRAPH_SERVER_PORT || 8123;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    service: 'langgraph-standalone-server',
    timestamp: new Date().toISOString(),
  });
});

/**
 * List available simulations with personas
 */
app.get('/simulations', async (_req: Request, res: Response) => {
  try {
    const simulations = await listSimulations();
    res.json({ simulations });
  } catch (error: any) {
    console.error('Error listing simulations:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List sessions (optionally filtered by userId)
 */
app.get('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    const sessions = await listSessions(userId);
    
    res.json({ 
      sessions: sessions.map(s => ({
        id: s.id,
        simulationId: s.simulation?.id,
        simulationTitle: s.simulation?.title,
        userId: (s.user as any)?.id,
        status: s.status,
        messageCount: s.messageCount,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
    });
  } catch (error: any) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create a new session
 */
app.post('/sessions', async (req: Request, res: Response) => {
  try {
    const { simulationId, personaId, userId } = req.body;
    
    if (!simulationId) {
      return res.status(400).json({ error: 'simulationId is required' });
    }
    
    const session = await createSession(simulationId, personaId, userId);
    
    res.status(201).json({
      session: {
        id: session.id,
        simulationId: session.simulation?.id,
        simulationTitle: session.simulation?.title,
        personaId: session.simulation?.personas?.[0]?.id,
        personaName: session.simulation?.personas?.[0]?.name,
        userId: (session.user as any)?.id,
        status: session.status,
        threadId: session.id, // threadId = sessionId
      },
    });
  } catch (error: any) {
    console.error('Error creating session:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Get session details
 */
app.get('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = await getSessionById(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({
      session: {
        id: session.id,
        simulationId: session.simulation?.id,
        simulationTitle: session.simulation?.title,
        personaId: session.simulation?.personas?.[0]?.id,
        personaName: session.simulation?.personas?.[0]?.name,
        userId: (session.user as any)?.id,
        status: session.status,
        messageCount: session.messageCount,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        threadId: session.id,
      },
    });
  } catch (error: any) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Invoke the graph (LangGraph protocol - invoke mode)
 * Compatible with LangGraph Studio and MCP clients
 */
app.post('/threads/:threadId/runs', async (req: Request, res: Response) => {
  try {
    const { threadId } = req.params;
    const { input } = req.body;
    
    // Validate session exists
    const session = await getSessionById(threadId);
    if (!session) {
      return res.status(404).json({ error: `Session/Thread ${threadId} not found` });
    }
    
    // Build conversation input
    const conversationInput: ConversationInput = {
      sessionId: threadId,
      userId: (session.user as any)?.id || '',
      userMessage: input?.message || input?.userMessage,
      proactiveTrigger: input?.proactiveTrigger,
      metadata: input?.metadata,
    };
    
    console.log(`🔵 Invoking graph for thread ${threadId}:`, {
      userMessage: conversationInput.userMessage,
      proactiveTrigger: conversationInput.proactiveTrigger,
    });
    
    // Invoke the graph
    const result = await invokeConversationGraph(conversationInput, { threadId });
    
    res.json({
      output: {
        sessionId: result.sessionId,
        lastAiMessage: result.lastAiMessage,
        turn: result.turn,
        messages: result.messages,
        goalProgress: result.goalProgress,
        metadata: result.metadata,
      },
      threadId,
    });
  } catch (error: any) {
    console.error('Error invoking graph:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

/**
 * Stream the graph execution (LangGraph protocol - streaming mode)
 * Compatible with LangGraph Studio and MCP clients
 */
app.post('/threads/:threadId/runs/stream', async (req: Request, res: Response) => {
  try {
    const { threadId } = req.params;
    const { input } = req.body;
    
    // Validate session exists
    const session = await getSessionById(threadId);
    if (!session) {
      return res.status(404).json({ error: `Session/Thread ${threadId} not found` });
    }
    
    // Build conversation input
    const conversationInput: ConversationInput = {
      sessionId: threadId,
      userId: (session.user as any)?.id || '',
      userMessage: input?.message || input?.userMessage,
      proactiveTrigger: input?.proactiveTrigger,
      metadata: input?.metadata,
    };
    
    console.log(`🔵 Streaming graph for thread ${threadId}:`, {
      userMessage: conversationInput.userMessage,
      proactiveTrigger: conversationInput.proactiveTrigger,
    });
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Stream the graph execution
    const stream = streamConversationGraph(conversationInput, { threadId });
    
    for await (const chunk of stream) {
      // Send each chunk as SSE event
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    
    // End the stream
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Error streaming graph:', error);
    
    // If headers not sent, send error response
    if (!res.headersSent) {
      res.status(500).json({ error: error.message, stack: error.stack });
    } else {
      // Otherwise send error as SSE event and close
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

/**
 * Get the compiled graph (for introspection)
 */
app.get('/graph', (_req: Request, res: Response) => {
  try {
    const graph = getConversationGraph();
    res.json({
      message: 'Graph compiled successfully',
      nodes: Object.keys((graph as any).nodes || {}),
    });
  } catch (error: any) {
    console.error('Error getting graph:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Start the server
 */
async function startServer() {
  try {
    console.log('🚀 Starting LangGraph Standalone Server...');
    
    // Initialize database
    console.log('📊 Connecting to database...');
    await initializeDatabase();
    
    // Compile graph
    console.log('🔧 Compiling conversation graph...');
    getConversationGraph();
    
    // Start listening
    app.listen(PORT, () => {
      console.log('');
      console.log('✅ LangGraph Standalone Server is running!');
      console.log('');
      console.log(`   📍 Server URL: http://localhost:${PORT}`);
      console.log(`   🏥 Health Check: http://localhost:${PORT}/health`);
      console.log(`   📚 Simulations: http://localhost:${PORT}/simulations`);
      console.log('');
      console.log('   To test:');
      console.log(`   1. List simulations: GET http://localhost:${PORT}/simulations`);
      console.log(`   2. Create session: POST http://localhost:${PORT}/sessions`);
      console.log(`   3. Invoke conversation: POST http://localhost:${PORT}/threads/{sessionId}/runs`);
      console.log('');
      console.log('   Press Ctrl+C to stop');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});

// Start the server
startServer();

// Export the graph for LangGraph CLI compatibility
export { getConversationGraph as graph };

