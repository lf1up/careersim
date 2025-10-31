# LangGraph Migration Guide

## What Was Built

A complete LangGraph-based conversation system has been implemented with the following components:

### ✅ Completed Components

1. **State Management** (`backend/src/services/langgraph/state.ts`)
   - `ConversationGraphState` interface with all necessary fields
   - Helper functions for state conversion and metrics

2. **Checkpointing** (`backend/src/services/langgraph/checkpointer.ts`)
   - Custom PostgreSQL-backed checkpointer
   - Stores conversation state alongside sessions
   - Enables time-travel debugging

3. **Prompt Templates** (`backend/src/services/langgraph/prompts.ts`)
   - Persona system prompt with RAG integration
   - Proactive message prompts (start, inactivity, follow-up, backchannel)
   - Anti-repetition guidance built-in

4. **Graph Definition** (`backend/src/services/langgraph/graph.ts`)
   - Complete StateGraph with all nodes and conditional edges
   - Entry points for invocation and streaming

5. **Conversation Nodes** (`backend/src/services/langgraph/nodes/conversation.ts`)
   - process_user_input
   - fetch_rag_context
   - generate_ai_response
   - analyze_response

6. **Proactive Message Nodes** (`backend/src/services/langgraph/nodes/proactive.ts`)
   - check_proactive_trigger
   - generate_proactive_message (with similarity checks)

7. **Evaluation System** (`backend/src/services/langgraph/nodes/evaluation.ts` + `tools/evaluation_tools.ts`)
   - Goal evaluation node with LangChain tools
   - Behavior and indicator analysis tools
   - Integration with Transformers microservice

8. **Persistence Nodes** (`backend/src/services/langgraph/nodes/persistence.ts`)
   - persist_and_emit (saves to DB, emits Socket.IO)
   - schedule_inactivity

9. **Configuration** (`backend/src/config/env.ts`)
   - Added all LangGraph environment variables
   - Feature flag support

10. **Dependencies** (`backend/package.json`)
    - Added @langchain/langgraph, @langchain/core, @langchain/openai, langsmith

## Next Steps

### 1. Install Dependencies

```bash
cd /Users/lf1up/Projects/careersim/backend
nvm use 22
pnpm install
```

This will install:
- `@langchain/langgraph@^0.2.20`
- `@langchain/core@^0.3.22`
- `@langchain/openai@^0.3.14`
- `@langchain/community@^0.3.17`
- `langsmith@^0.2.9`

### 2. Update Environment Variables

Add to your `.env` file (at project root):

```bash
# LangGraph Configuration
USE_LANGGRAPH=false                    # Set to true when ready to test
LANGGRAPH_DEPLOYMENT_URL=              # Optional: for deployed graph
LANGGRAPH_API_KEY=                     # Optional: for LangGraph Cloud

# LangSmith (optional, for debugging/tracing)
LANGCHAIN_TRACING_V2=false             # Set to true for tracing
LANGCHAIN_PROJECT=careersim-dev
LANGCHAIN_API_KEY=                     # Your LangSmith API key

# Graph Configuration
GRAPH_ASSISTANT_ID=                    # Optional: assistant ID when deployed
```

### 3. Test Locally (Without Deployment)

Create a test script or add to existing routes:

```typescript
// Test file: backend/src/test-langgraph.ts
import { invokeConversationGraph, sessionToGraphState } from '@/services/langgraph';
import { AppDataSource } from '@/config/database';
import { SimulationSession } from '@/entities/SimulationSession';

async function testGraph() {
  await AppDataSource.initialize();
  
  // Load a test session
  const session = await AppDataSource.getRepository(SimulationSession).findOne({
    where: { id: 'your-session-id' },
    relations: ['simulation', 'simulation.personas', 'user'],
  });
  
  if (!session) {
    console.error('Session not found');
    return;
  }
  
  // Invoke graph
  const result = await invokeConversationGraph({
    sessionId: session.id,
    userId: session.user.id,
    userMessage: 'Hello, can you help me?',
  });
  
  console.log('Graph result:', result);
}

testGraph().catch(console.error);
```

### 4. Integrate with Routes (Gradual Migration)

Update `backend/src/routes/simulations.ts`:

```typescript
// At the top
import { config } from '@/config/env';
import { invokeConversationGraph } from '@/services/langgraph';

// In the message route handler
if (type === MessageType.USER && session.simulation?.personas?.length > 0) {
  try {
    // Check feature flag
    if (config.langgraph.useLangGraph) {
      // NEW: Use LangGraph
      console.log('🔵 Using LangGraph for conversation');
      
      const result = await invokeConversationGraph({
        sessionId,
        userId: req.user!.id,
        userMessage: content,
      });
      
      // Result already persisted and emitted by graph
      // Just return success
      return res.status(201).json({ message: transformedMessage });
    } else {
      // OLD: Existing AIService implementation
      const { AIService } = await import('@/services/ai');
      // ... existing code ...
    }
  } catch (error) {
    console.error('Error in conversation:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
}
```

### 5. Update Inactivity Scheduler

Update `backend/src/services/realtime.ts`:

```typescript
// At the top
import { config } from '@/config/env';
import { invokeConversationGraph } from '@/services/langgraph';

// In the startInactivityScheduler function
if (config.langgraph.useLangGraph) {
  // NEW: Use LangGraph for inactivity nudges
  console.log('🔵 Using LangGraph for inactivity nudge');
  
  await invokeConversationGraph({
    sessionId: s.id,
    userId: (s.user as any).id,
    proactiveTrigger: 'inactivity',
  });
  
  // Graph handles all persistence and scheduling
  continue;
} else {
  // OLD: Existing implementation
  // ... existing code ...
}
```

### 6. Update Session Start

Update `backend/src/routes/simulations.ts` start-session endpoint:

```typescript
// After creating session
if (persona && startsConversation && config.langgraph.useLangGraph) {
  // NEW: Use LangGraph for start message
  console.log('🔵 Using LangGraph for start message');
  
  await invokeConversationGraph({
    sessionId: session.id,
    userId: req.user!.id,
    proactiveTrigger: 'start',
  });
} else if (persona && startsConversation) {
  // OLD: Existing implementation
  // ... existing code ...
}
```

### 7. Enable LangSmith Tracing (Optional)

For debugging and monitoring:

1. Sign up at https://smith.langchain.com
2. Get your API key
3. Set environment variables:

```bash
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_api_key
LANGCHAIN_PROJECT=careersim-dev
```

4. View traces in LangSmith dashboard

### 8. Gradual Rollout

1. **Test in Development**: Set `USE_LANGGRAPH=true` in dev environment
2. **Test All Features**:
   - Normal user messages → AI responses
   - Session start messages
   - Inactivity nudges
   - Follow-up messages
   - Backchannel requests
   - Goal evaluation

3. **Monitor**: Compare outputs with old system
4. **Canary**: Roll out to small % of users
5. **Full Rollout**: Once stable, set `USE_LANGGRAPH=true` for all

### 9. Deployment Options

#### Option A: Direct Invocation (Current)
- No deployment needed
- Graph runs directly in backend
- Good for testing and initial rollout

#### Option B: LangGraph Cloud (Future)
1. Create LangGraph Cloud account
2. Deploy graph: `langgraph deploy`
3. Get assistant ID
4. Update code to use LangGraph SDK client
5. Benefits: Scaling, managed infrastructure, built-in monitoring

#### Option C: Self-Hosted (Future)
1. Run LangGraph server in Docker
2. Deploy alongside backend
3. Same API as Cloud, more control

## Architecture Diagram

```
User Message
     ↓
process_user_input (load session, add message)
     ↓
fetch_rag_context (call RAG microservice)
     ↓
generate_ai_response (ChatOpenAI + persona prompt)
     ↓
analyze_response (Transformers: emotion, sentiment)
     ↓
evaluate_goals (agent with tools: behavior, indicators)
     ↓
check_proactive_trigger (backchannel? follow-up?)
     ↓
  [conditional]
     ↓
generate_proactive_message (if needed)
     ↓
persist_and_emit (save to DB, emit Socket.IO)
     ↓
schedule_inactivity (set next nudge time)
     ↓
END
```

## Key Benefits

✅ **State Management**: Built-in checkpointing, no manual state tracking  
✅ **Modularity**: Each node is isolated, easy to test and modify  
✅ **Conditional Routing**: Smart decisions about proactive messages  
✅ **Tool Integration**: Agent-based goal evaluation  
✅ **Observability**: LangSmith tracing shows complete flow  
✅ **Streaming**: Can stream tokens in real-time to frontend  
✅ **Deployment Ready**: Can deploy to LangGraph Cloud  
✅ **Backward Compatible**: Feature flag allows gradual migration  

## Testing Checklist

- [ ] Dependencies installed (`pnpm install`)
- [ ] Environment variables configured
- [ ] Basic graph invocation works
- [ ] Normal conversation flow works
- [ ] Proactive start messages work
- [ ] Inactivity nudges work
- [ ] Follow-up messages work
- [ ] Backchannel requests work
- [ ] Goal evaluation works correctly
- [ ] Messages persisted to database
- [ ] Socket.IO events emitted
- [ ] LangSmith tracing (if enabled)
- [ ] Performance acceptable (<2s p95)
- [ ] No regressions vs old system

## Troubleshooting

### Import Errors
- Run `pnpm install` to install dependencies
- Check Node version: `node --version` (should be >=22.0.0)

### Graph Execution Errors
- Check LangSmith traces for detailed flow
- Verify environment variables are set
- Check database connections
- Ensure RAG/Transformers microservices are running

### Performance Issues
- Enable LangSmith to identify slow nodes
- Consider caching RAG contexts
- Optimize Transformers API calls
- Use streaming for long responses

### State/Checkpoint Issues
- Check `session.metadata.checkpoints` in database
- Verify checkpointer is saving correctly
- Use `getLatestCheckpoint()` to inspect state

## Support

- **Documentation**: See `backend/src/services/langgraph/README.md`
- **Code Examples**: Check `backend/src/services/langgraph/index.ts` for exports
- **LangChain Docs**: https://python.langchain.com/docs/langgraph
- **LangSmith**: https://smith.langchain.com

## Next Phase: Advanced Features

Once basic system is stable:

1. **Parallel Nodes**: Run RAG + Transformers in parallel
2. **Subgraphs**: Separate evaluation subgraph
3. **Streaming Tools**: Stream RAG results as they arrive
4. **Human-in-Loop**: Add approval nodes
5. **Multi-Agent**: Multiple personas in same conversation
6. **Voice Support**: Add speech-to-text/text-to-speech nodes
7. **Analytics**: Custom metrics and dashboards

## Migration Status

- [x] Core infrastructure built
- [x] All nodes implemented
- [x] Tools and evaluation system
- [x] Configuration and environment
- [ ] Dependencies installed (user needs to run `pnpm install`)
- [ ] Environment variables configured
- [ ] Local testing
- [ ] Route integration
- [ ] Production deployment

## Questions?

Review the comprehensive plan in `langchain-migration-plan.plan.md` for detailed architecture and design decisions.

