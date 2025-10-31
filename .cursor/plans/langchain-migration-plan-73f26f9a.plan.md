<!-- 73f26f9a-d47a-4625-a66d-1def70f1e315 a7f262c8-90f3-479a-9a29-35054d7d7f71 -->
# LangGraph Agent Migration Plan

## Vision: Stateful Agent Graph Architecture

Transform CareerSim into a **LangGraph-powered agent system** where the entire conversation flow is a deployable stateful graph. Access everything through a single graph/assistant ID via LangGraph Cloud deployment.

## Why LangGraph > Basic LangChain?

- ✅ **Stateful Multi-Actor System**: Nodes for conversation, proactive messages, evaluation all in one graph
- ✅ **Conditional Routing**: Smart edges determine when to respond, follow-up, evaluate, or nudge
- ✅ **Persistent State**: Built-in checkpointing with PostgreSQL backend
- ✅ **Deployment Ready**: Deploy to LangGraph Cloud/Platform, access via assistant ID
- ✅ **Streaming & Interrupts**: Stream tokens in real-time, pause/resume conversations
- ✅ **Human-in-the-Loop**: Support for approvals, interventions (future feature)
- ✅ **Time-Travel Debugging**: Replay conversations from any checkpoint
- ✅ **Tool Integration**: RAG and evaluation become graph nodes with tool calls

## Architecture: The Conversation StateGraph

### Graph State Schema

```typescript
interface ConversationGraphState {
  sessionId: string;
  userId: string;
  messages: BaseMessage[];  // LangChain message format
  persona: Persona;
  simulation: Simulation;
  goalProgress: GoalProgress[];
  turn: 'user' | 'ai';
  lastUserMessage?: string;
  lastAiMessage?: string;
  proactiveTrigger?: 'followup' | 'inactivity' | 'backchannel' | 'start';
  ragContext?: string;
  needsEvaluation: boolean;
  shouldSendProactive: boolean;
  proactiveCount: number;
  metadata: Record<string, any>;
}
```

### Graph Nodes

1. **`process_user_input`**: Entry point, loads session state, adds user message
2. **`fetch_rag_context`**: Calls RAG microservice, injects context into state
3. **`generate_ai_response`**: Main conversation node with ChatOpenAI + persona prompt
4. **`analyze_response`**: Post-process with Transformers (sentiment, emotion, quality)
5. **`evaluate_goals`**: Agent node with tools to assess goal achievement
6. **`check_proactive_trigger`**: Determines if proactive message needed (follow-up, backchannel)
7. **`generate_proactive_message`**: Creates follow-ups, nudges with anti-repetition
8. **`persist_and_emit`**: Saves to DB, emits via Socket.IO, updates state
9. **`schedule_inactivity`**: Schedules next inactivity check
10. **`end`**: Terminal node

### Graph Edges & Routing

```
START → process_user_input → fetch_rag_context → generate_ai_response
       ↓
generate_ai_response → analyze_response → evaluate_goals
       ↓                                       ↓
evaluate_goals → check_proactive_trigger → [conditional]
                                              ↓
                        ┌─────────────────────┴──────────────────┐
                        ↓                                         ↓
              generate_proactive_message              persist_and_emit → schedule_inactivity → END
                        ↓
              persist_and_emit (proactive) → check_proactive_trigger (loop check)
```

**Conditional Logic**:

- After `check_proactive_trigger`: if `shouldSendProactive && proactiveCount < max`, go to `generate_proactive_message`
- If backchannel triggered, generate then return to waiting for user
- Follow-up messages can loop (multi-burst support)

### Inactivity Handling

Instead of interval-based polling:

- Use **LangGraph scheduled invocations** or external cron to invoke graph with `proactiveTrigger: 'inactivity'`
- Graph checks elapsed time, persona config, generates nudge if needed
- All state managed through graph checkpoints

## Implementation Plan

### Phase 1: LangGraph Foundation

**Files to Create**:

- `backend/src/services/langgraph/state.ts` - Define `ConversationGraphState` interface
- `backend/src/services/langgraph/graph.ts` - Main StateGraph definition
- `backend/src/services/langgraph/checkpointer.ts` - Custom PostgreSQL checkpointer using SessionMessage table

**Tasks**:

1. Install LangGraph packages: `@langchain/langgraph`, `@langchain/core`, `@langchain/openai`, `langsmith`
2. Define state schema matching session/simulation entities
3. Create custom checkpointer that saves state to database alongside messages
4. Initialize base StateGraph with empty nodes

### Phase 2: Core Conversation Nodes

**Files**:

- `backend/src/services/langgraph/nodes/conversation.ts`
- `backend/src/services/langgraph/nodes/rag.ts`
- `backend/src/services/langgraph/nodes/analysis.ts`

**Nodes to Implement**:

1. `process_user_input`: Load session, validate, add user message to state
2. `fetch_rag_context`: Call RAG microservice (existing), add to state
3. `generate_ai_response`: 

   - Use ChatOpenAI with persona system prompt
   - Access conversation history from state.messages
   - Generate response, add to state

4. `analyze_response`:

   - Call Transformers microservice (existing)
   - Add emotion, sentiment, quality scores to metadata

### Phase 3: Proactive Message System

**Files**:

- `backend/src/services/langgraph/nodes/proactive.ts`
- `backend/src/services/langgraph/prompts.ts` - Specialized prompts for each proactive type

**Nodes to Implement**:

1. `check_proactive_trigger`:

   - Analyze last user message (short? ambiguous? → backchannel)
   - Check if follow-up needed (persona config, random probability)
   - Set `shouldSendProactive` and `proactiveTrigger` in state

2. `generate_proactive_message`:

   - Select prompt based on `proactiveTrigger` type
   - Include recent messages for anti-repetition
   - Higher temperature for variety
   - Similarity check against recent AI messages
   - If too similar, either retry or skip

**Conditional Edge**:

- After `check_proactive_trigger`: route to `generate_proactive_message` or `persist_and_emit`
- After `generate_proactive_message`: can loop back to generate more (follow-up burst) or proceed to persist

### Phase 4: Goal Evaluation Agent

**Files**:

- `backend/src/services/langgraph/nodes/evaluation.ts`
- `backend/src/services/langgraph/tools/evaluation_tools.ts`

**Evaluation Tools** (LangChain tools used by subgraph):

1. `analyze_user_behavior_tool`: Score user message against key behaviors using zero-shot classification
2. `analyze_ai_indicators_tool`: Score AI response against success indicators
3. `get_goal_context_tool`: Retrieve goal definitions, current progress
4. `update_goal_progress_tool`: Update progress with evidence

**Node Implementation**:

- `evaluate_goals`: 
  - Create a ReAct agent or subgraph with above tools
  - Agent reasons about which goals are achieved
  - Updates state.goalProgress with evidence and confidence
  - Emits goal-progress-updated event via Socket.IO

### Phase 5: Persistence & Communication

**Files**:

- `backend/src/services/langgraph/nodes/persistence.ts`
- `backend/src/services/langgraph/integrations/socketio.ts`

**Nodes**:

1. `persist_and_emit`:

   - Save AI message to SessionMessage table
   - Update session turn, counters, timestamps
   - Emit message via Socket.IO to connected clients
   - Update checkpoint

2. `schedule_inactivity`:

   - Calculate next inactivity nudge time based on persona config
   - Store in session.inactivityNudgeAt
   - Return to END

### Phase 6: LangGraph Deployment Setup

**Files**:

- `backend/src/services/langgraph/deployment.ts` - Graph deployment wrapper
- `backend/langgraph.json` - LangGraph configuration file
- `backend/src/services/langgraph/client.ts` - Client for interacting with deployed graph

**Deployment Options**:

**Option A: LangGraph Cloud** (Recommended)

- Deploy graph to LangGraph Cloud
- Get assistant/graph ID
- Frontend/backend calls graph via LangGraph SDK
- Built-in streaming, persistence, monitoring

**Option B: Self-Hosted LangGraph Server**

- Run LangGraph server in Docker container
- Deploy alongside backend
- More control, same API

**Integration**:

1. Wrap graph execution in deployment client
2. Update routes to invoke graph via assistant ID
3. Stream responses back to client
4. Handle interrupts and checkpoints

### Phase 7: Route Integration

**Files to Modify**:

- `backend/src/routes/simulations.ts`
- `backend/src/services/realtime.ts`

**Changes**:

**Message Route** (`POST /simulations/:id/sessions/:sessionId/messages`):

```typescript
// OLD: const aiResponse = await aiService.generatePersonaResponse(...)
// NEW:
const graphClient = getGraphClient();
const stream = await graphClient.stream({
  threadId: sessionId,
  input: { 
    userMessage: content,
    sessionId,
    userId: req.user.id 
  }
});

// Stream tokens back via Socket.IO
for await (const chunk of stream) {
  io.to(`session-${sessionId}`).emit('message-chunk', chunk);
}
```

**Inactivity Scheduler**:

- Keep interval polling OR use LangGraph scheduled invocations
- Invoke graph with `proactiveTrigger: 'inactivity'`
- Graph handles nudge generation and sending

**Session Start**:

- Invoke graph with `proactiveTrigger: 'start'` if persona initiates
- Graph handles opening message

### Phase 8: Observability & Tracing

**Files**:

- `backend/src/services/langgraph/callbacks.ts`

**Features**:

1. LangSmith tracing (automatic with LangGraph Cloud)
2. Custom callbacks for:

   - Token usage tracking
   - Latency per node
   - Error rates
   - Goal evaluation accuracy

3. Integration with Winston logger
4. Metrics export to monitoring system

### Phase 9: Migration Strategy

**Gradual Rollout**:

1. Add `USE_LANGGRAPH` feature flag in config
2. Implement dual path:

   - Old: `AIService` methods
   - New: LangGraph invocations

3. Test in dev with flag enabled
4. Shadow mode: run both, compare outputs (log only)
5. Canary: small % of users on LangGraph
6. Full rollout
7. Remove old AIService code

**Backward Compatibility**:

- Keep AIService as a facade wrapping graph calls initially
- Same response format (`AIResponse` interface)
- Same database schema
- Same Socket.IO events

## Files to Create

```
backend/src/services/langgraph/
├── state.ts                    # ConversationGraphState interface
├── graph.ts                    # Main StateGraph definition & builder
├── checkpointer.ts             # PostgreSQL checkpointer
├── deployment.ts               # Deployment wrapper & config
├── client.ts                   # Client for deployed graph
├── callbacks.ts                # Custom callbacks & tracing
├── prompts.ts                  # Prompt templates for all nodes
├── nodes/
│   ├── conversation.ts         # Core conversation nodes
│   ├── proactive.ts            # Proactive message generation
│   ├── evaluation.ts           # Goal evaluation agent node
│   ├── rag.ts                  # RAG context fetching
│   ├── analysis.ts             # Transformers analysis
│   └── persistence.ts          # DB persistence & Socket.IO
├── tools/
│   └── evaluation_tools.ts     # Tools for evaluation agent
├── integrations/
│   └── socketio.ts             # Socket.IO event emission
└── index.ts                    # Main exports
```
```
backend/langgraph.json          # LangGraph deployment config
```

## Configuration Updates

### Environment Variables

```bash
# LangGraph Configuration
LANGGRAPH_DEPLOYMENT_URL=https://your-deployment.langchain.com
LANGGRAPH_API_KEY=your_api_key
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=careersim-production

# Feature Flag
USE_LANGGRAPH=true

# Graph Configuration
GRAPH_ASSISTANT_ID=your_assistant_id
GRAPH_CHECKPOINT_DB=postgresql://...
```

### Dependencies

```json
{
  "@langchain/langgraph": "^0.2.0",
  "@langchain/core": "^0.3.0",
  "@langchain/openai": "^0.3.0",
  "@langchain/community": "^0.3.0",
  "langsmith": "^0.2.0"
}
```

### LangGraph Config (`langgraph.json`)

```json
{
  "dependencies": ["@langchain/langgraph", "@langchain/openai"],
  "graphs": {
    "conversation_agent": "./src/services/langgraph/graph.ts:conversationGraph"
  },
  "env": [
    "OPENAI_API_KEY",
    "DATABASE_URL",
    "RAG_API_URL",
    "TRANSFORMERS_API_URL"
  ]
}
```

## Benefits of LangGraph Approach

1. **True Agent Architecture**: Multi-node graph with conditional routing, not just chains
2. **State Management**: Built-in persistent state with checkpointing
3. **Deployment as Service**: Deploy graph, access via ID, decouple from main backend
4. **Streaming**: Real-time token streaming to frontend
5. **Debugging**: Time-travel through conversation checkpoints
6. **Scalability**: LangGraph Cloud handles scaling, state persistence
7. **Human-in-Loop**: Easy to add approval nodes, interventions
8. **Tool Orchestration**: Clean separation of concerns (RAG, evaluation as nodes/tools)
9. **Observability**: Built-in LangSmith tracing, no manual instrumentation
10. **Future-Proof**: Easy to add new nodes (voice, multi-modal, etc.)

## Advanced Features (Post-Migration)

Once core graph is working:

1. **Subgraphs**: Separate subgraph for complex goal evaluation reasoning
2. **Parallel Nodes**: Run RAG + Transformers analysis in parallel
3. **Cycles**: Allow AI to self-critique and revise responses
4. **Map-Reduce**: Evaluate multiple goals simultaneously
5. **Streaming Tools**: Stream RAG results as they arrive
6. **Interrupts**: Pause conversation for approval/moderation
7. **Multi-Agent**: Multiple personas in same conversation (future)

## Migration Risks & Mitigations

| Risk | Mitigation |

|------|------------|

| Learning curve for LangGraph | Start with simple linear graph, add complexity gradually |

| State schema evolution | Version state, support migrations |

| Deployment complexity | Use LangGraph Cloud for managed infrastructure |

| Performance overhead | Benchmark vs old system, optimize hot paths |

| Debugging difficulty | Leverage LangSmith tracing, checkpoint replay |

| Breaking changes | Maintain old API as facade during transition |

## Key Preservations

- ✅ RAG microservice (wrapped as graph node)
- ✅ Transformers microservice (wrapped as graph node)
- ✅ Database schema (used for checkpointing)
- ✅ Socket.IO events (emitted from persistence node)
- ✅ Persona configs (injected into graph state)
- ✅ API contracts (AIService becomes graph wrapper)
- ✅ Similarity checks (in proactive message node)
- ✅ Goal evaluation logic (in evaluation agent node)

## Success Metrics

- [ ] Graph successfully handles user messages → AI responses
- [ ] Proactive messages (start, follow-up, backchannel, inactivity) work via graph
- [ ] Goal evaluation agent produces accurate results
- [ ] State persists correctly across conversations
- [ ] Streaming works end-to-end
- [ ] LangSmith tracing shows complete flow
- [ ] Performance within acceptable bounds (<2s p95 response time)
- [ ] No regressions in conversation quality
- [ ] Can access entire app via graph/assistant ID

This is the **modern, agent-based, deployment-ready architecture** that fully leverages LangGraph's power!

### To-dos

- [ ] Install LangChain packages (@langchain/core, @langchain/openai, @langchain/community, langsmith) and add env config
- [ ] Create custom DatabaseChatMemory class that syncs with SessionMessage table
- [ ] Create prompt templates for all message types (persona system, proactive variations)
- [ ] Build PersonaConversationChain and refactor generatePersonaResponse() to use it
- [ ] Build ProactiveMessageChain and refactor generateProactivePersonaMessage()
- [ ] Define LangChain tools for goal evaluation (behavior analysis, response analysis, context retrieval)
- [ ] Create GoalEvaluationAgent and refactor evaluateAfterTurnLLM()
- [ ] Set up LangSmith tracing and custom callbacks for observability
- [ ] Update tests and validate all message types work correctly with LangChain
- [ ] Add feature flag for gradual rollout and dual-path implementation