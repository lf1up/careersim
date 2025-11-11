# LangGraph Conversation System

This directory contains the LangGraph-based conversation agent system for CareerSim, providing a stateful, multi-node graph architecture for managing AI conversations, proactive messages, and goal evaluation.

## Standalone Server for Testing

Test the LangGraph system independently with the standalone server:

```bash
# Start standalone server (port 8123)
pnpm --filter careersim-backend langgraph:server

# Run automated tests
pnpm --filter careersim-backend langgraph:test
```

**Port Configuration**: The standalone server uses port **8123** by default (configurable via `LANGGRAPH_SERVER_PORT`) to avoid conflicts with the main backend server (port 8000). See `standalone-server.ts` for API details.

## Architecture Overview

The system is built as a **StateGraph** with multiple nodes handling different aspects of the conversation:

```
START → process_user_input → fetch_rag_context → generate_ai_response
       ↓
generate_ai_response → analyze_response → evaluate_goals
       ↓
evaluate_goals → check_proactive_trigger → [conditional routing]
       ↓
[generate_proactive_message OR persist_and_emit] → schedule_inactivity → END
```

## Key Components

### State Management (`state.ts`)
- `ConversationGraphState`: Main state schema tracking conversation, goals, persona, metadata
- Helper functions for state conversion and metrics extraction
- Supports checkpointing for conversation replay and debugging

### Checkpointing (`checkpointer.ts`)
- Custom `DatabaseCheckpointSaver` that stores checkpoints in PostgreSQL
- Integrates with existing `SimulationSession` table
- Enables time-travel debugging and conversation replay

### Prompt Templates (`prompts.ts`)
- **Persona System Prompt**: Injects persona details, simulation context, RAG knowledge
- **Proactive Prompts**: Specialized templates for start, inactivity, follow-up, backchannel messages
- Anti-repetition guidance built-in

### Graph Definition (`graph.ts`)
- Main `StateGraph` with all nodes and edges
- Conditional routing for proactive messages and follow-ups
- Entry points: `invokeConversationGraph()`, `streamConversationGraph()`

### Nodes

#### Conversation Nodes (`nodes/conversation.ts`)
1. **process_user_input**: Loads session, adds user message to state
2. **fetch_rag_context**: Calls RAG microservice for grounding knowledge
3. **generate_ai_response**: Uses ChatOpenAI to generate persona-based response
4. **analyze_response**: Post-processes with Transformers (emotion, sentiment, quality)

#### Proactive Nodes (`nodes/proactive.ts`)
1. **check_proactive_trigger**: Determines if proactive message needed (backchannel, follow-up)
2. **generate_proactive_message**: Creates proactive messages with anti-repetition checks

#### Evaluation Node (`nodes/evaluation.ts`)
- **evaluate_goals**: Uses tools to assess conversation goal achievement
- Updates goal progress with evidence and confidence scores

#### Persistence Nodes (`nodes/persistence.ts`)
1. **persist_and_emit**: Saves messages to DB, emits via Socket.IO
2. **schedule_inactivity**: Schedules next inactivity nudge

### Tools (`tools/evaluation_tools.ts`)
LangChain tools for goal evaluation:
- `analyze_user_behavior_tool`: Scores user message against key behaviors
- `analyze_ai_indicators_tool`: Scores AI response against success indicators
- `get_conversation_window_tool`: Retrieves recent messages
- `get_goal_context_tool`: Retrieves goal definitions

## Usage

### Basic Invocation

```typescript
import { invokeConversationGraph, ConversationInput } from '@/services/langgraph';

const input: ConversationInput = {
  sessionId: 'session-123',
  userId: 'user-456',
  userMessage: 'Hello, I need help with...',
};

const result = await invokeConversationGraph(input);
```

### Streaming (Real-time)

```typescript
import { streamConversationGraph } from '@/services/langgraph';

for await (const chunk of streamConversationGraph(input)) {
  console.log('Graph state update:', chunk);
  // Emit chunks to frontend via Socket.IO
}
```

### Proactive Messages

```typescript
// Start message
const startInput: ConversationInput = {
  sessionId: 'session-123',
  userId: 'user-456',
  proactiveTrigger: 'start',
};
await invokeConversationGraph(startInput);

// Inactivity nudge
const nudgeInput: ConversationInput = {
  sessionId: 'session-123',
  userId: 'user-456',
  proactiveTrigger: 'inactivity',
};
await invokeConversationGraph(nudgeInput);
```

## Configuration

Environment variables (see `backend/src/config/env.ts`):

```bash
# LangGraph
USE_LANGGRAPH=true                     # Feature flag
LANGGRAPH_DEPLOYMENT_URL=             # Optional: deployed graph URL
LANGGRAPH_API_KEY=                    # Optional: for LangGraph Cloud

# LangSmith (tracing/debugging)
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=careersim-dev
LANGCHAIN_API_KEY=                    # LangSmith API key

# Graph Configuration
GRAPH_ASSISTANT_ID=                    # Assistant ID for deployed graph
```

## Integration with Existing System

### Routes Integration

The graph can be invoked from routes:

```typescript
// In routes/simulations.ts
import { invokeConversationGraph } from '@/services/langgraph';

// Replace old AIService call
const result = await invokeConversationGraph({
  sessionId,
  userId: req.user!.id,
  userMessage: content,
});
```

### Inactivity Scheduler

The existing scheduler can invoke the graph:

```typescript
// In services/realtime.ts
import { invokeConversationGraph } from '@/services/langgraph';

await invokeConversationGraph({
  sessionId: session.id,
  userId: session.user.id,
  proactiveTrigger: 'inactivity',
});
```

## Key Features

✅ **Stateful Conversations**: Built-in state management with checkpointing  
✅ **Proactive Messages**: Start, follow-up, backchannel, inactivity nudges  
✅ **Goal Evaluation**: Agent-based goal assessment with tools  
✅ **Anti-Repetition**: Similarity checks prevent repetitive responses  
✅ **RAG Integration**: Seamless integration with existing RAG microservice  
✅ **Transformers Integration**: Emotion, sentiment, quality analysis  
✅ **Database Persistence**: Saves to SessionMessage, emits via Socket.IO  
✅ **Observability**: LangSmith tracing support  

## Next Steps

1. **Install Dependencies**: Run `pnpm install` in backend directory
2. **Test Compilation**: Run `pnpm debug:graph:compile` to verify setup
3. **Test Locally**: Run `pnpm debug:graph:invoke` to test with sample data
4. **Test Streaming**: Run `pnpm debug:graph:stream` to see real-time execution
5. **Deploy (Optional)**: Deploy to LangGraph Cloud or self-hosted
6. **Integrate Routes**: Update routes to use graph instead of AIService
7. **Feature Flag**: Enable `USE_LANGGRAPH=true` gradually
8. **Monitor**: Use LangSmith for debugging and analytics

## Deployment Options

### Option A: LangGraph Cloud (Recommended)
- Deploy graph to LangGraph Cloud
- Access via assistant ID
- Built-in scaling, persistence, monitoring

### Option B: Self-Hosted
- Run LangGraph server in Docker
- More control, same API
- Requires infrastructure setup

### Option C: Direct Invocation (Current)
- Call graph directly from backend
- No separate deployment needed
- Good for development and testing

## File Structure

```
backend/src/services/langgraph/
├── state.ts                    # State schema and helpers
├── graph.ts                    # Main graph definition
├── checkpointer.ts             # PostgreSQL checkpointer
├── prompts.ts                  # Prompt templates
├── index.ts                    # Main exports
├── nodes/
│   ├── conversation.ts         # Core conversation nodes
│   ├── proactive.ts            # Proactive message nodes
│   ├── evaluation.ts           # Goal evaluation node
│   └── persistence.ts          # DB persistence nodes
├── tools/
│   └── evaluation_tools.ts     # LangChain tools for evaluation
├── scripts/                    # Debug and testing scripts
│   ├── debug-compile.ts        # Compile verification script
│   ├── test-invoke.ts          # Basic invocation test
│   ├── test-stream.ts          # Streaming test
│   ├── test-proactive.ts       # Proactive messages test
│   ├── visualize-graph.ts      # Graph visualization
│   └── README.md               # Scripts documentation
└── README.md                   # This file
```

## Debugging

### Standalone Debug Scripts

The LangGraph system includes standalone debugging scripts for testing and visualization without running the full backend:

```bash
# Verify graph compilation
pnpm debug:graph:compile

# Test with sample data
pnpm debug:graph:invoke

# Test streaming execution
pnpm debug:graph:stream

# Test proactive messages
pnpm debug:graph:proactive

# Visualize graph structure
pnpm debug:graph:visualize
```

See `scripts/README.md` for detailed documentation on all debug scripts.

### View Checkpoints

```typescript
import { getCheckpointer } from '@/services/langgraph';

const checkpointer = getCheckpointer();
const latest = await checkpointer.getLatestCheckpoint('session-123');
console.log('Latest checkpoint:', latest);
```

### Enable LangSmith Tracing

Set environment variables:
```bash
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_api_key
LANGCHAIN_PROJECT=careersim-dev
```

Then view traces at: https://smith.langchain.com

## Migrating from Old AIService

The old `AIService` can remain as a facade initially:

```typescript
// services/ai.ts
export class AIService {
  async generatePersonaResponse(context, userMessage) {
    if (config.langgraph.useLangGraph) {
      // Use LangGraph
      const result = await invokeConversationGraph({...});
      return this.convertGraphResult(result);
    } else {
      // Use old implementation
      return this.oldGeneratePersonaResponse(context, userMessage);
    }
  }
}
```

This allows gradual migration with A/B testing.

## Performance Considerations

- **Checkpointing**: Adds ~50-100ms per save (async)
- **Tool Calls**: Transformers tools add ~200-500ms
- **Streaming**: Reduces perceived latency for long responses
- **Caching**: Consider caching RAG contexts per session

## Testing

### End-to-End Test Suite with DeepEval

The LangGraph system includes a comprehensive end-to-end test suite using DeepEval's TypeScript SDK for automated conversation simulation and evaluation.

#### Test Location

```
backend/src/services/langgraph/tests/
├── simulation.spec.ts    # Main test suite (13 test cases)
├── helpers.ts            # Test utilities and server management
└── scenarios.ts          # ConversationalGolden scenario definitions
```

#### Running Tests

```bash
# Run full test suite (requires standalone server)
pnpm --filter careersim-backend run langgraph:test:deepeval

# Run specific test patterns
pnpm --filter careersim-backend run langgraph:test:deepeval -- --testNamePattern="Basic Conversation"
pnpm --filter careersim-backend run langgraph:test:deepeval -- --testNamePattern="DeepEval"

# Run with verbose output
pnpm --filter careersim-backend run langgraph:test:deepeval -- --verbose
```

#### Prerequisites

1. **Database must be seeded:**
   ```bash
   pnpm --filter careersim-backend run db:seed
   ```

2. **Standalone server** (auto-started by tests or run manually):
   ```bash
   pnpm --filter careersim-backend langgraph:server
   ```

3. **Optional - DeepEval API key** (for 4 simulator tests):
   ```bash
   # Add to .env file
   CONFIDENT_API_KEY=your-api-key-here
   ```

#### Test Coverage (13 Tests)

**✅ Core Functionality Tests (9 tests - No API key needed)**

1. **Basic Conversation Flow**
   - Simple multi-turn conversations
   - Conversation state persistence across turns

2. **Proactive Message Generation**
   - AI-initiated start messages
   - Followup triggers and probability checks

3. **Goal Tracking and Evaluation**
   - Goal progress during conversations
   - Confidence scoring and evidence collection

4. **Turn Management**
   - Proper alternation between user and AI
   - Turn state tracking

5. **Response Analysis**
   - Sentiment and emotional analysis integration
   - Metadata and quality scores

6. **Error Handling**
   - Empty message handling
   - Graceful error recovery

7. **State Persistence**
   - Conversation state checkpointing
   - Session data persistence

**⚡ DeepEval Simulator Tests (4 tests - Requires API key)**

8. **Basic Conversation Simulation**
   - Automated multi-turn conversation generation
   - Realistic user response simulation

9. **Goal Achievement Simulation**
   - Complex conversations progressing through milestones
   - Extended turn sequences (8+ turns)

10. **Proactive Start Scenario**
    - AI-initiated conversation handling
    - Continuation with simulated user responses

11. **Batch Scenarios**
    - Multiple conversation scenarios in sequence
    - Comprehensive integration testing

#### Test Configuration

**Timeouts** (due to LLM response times):
- Basic tests: 8 minutes
- DeepEval simulator tests: 20 minutes (includes API calls for user generation)
- Batch tests: 30 minutes (runs multiple scenarios sequentially)

**Environment Variables** (loaded from `.env`):
```env
# Required for standalone server tests
LANGGRAPH_SERVER_PORT=8123
LANGGRAPH_SERVER_URL=http://localhost:8123

# Optional: For DeepEval conversation simulator
CONFIDENT_API_KEY=your-api-key-here
```

#### Expected Test Duration

- **Without DeepEval** (9 tests): ~10 minutes
- **With DeepEval** (13 tests): ~20-25 minutes
- Individual test times:
  - Basic conversation: ~30 seconds - 2 minutes
  - DeepEval simulation: ~3-8 minutes per test

#### Test Results

```bash
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
Snapshots:   0 total
Time:        ~1400-1500 seconds (~23-25 minutes)
```

#### What Gets Tested

**Graph Execution:**
- ✅ All node executions (process, fetch RAG, generate, analyze, evaluate)
- ✅ Conditional routing logic
- ✅ State transitions and persistence
- ✅ Checkpoint creation and retrieval

**Proactive Messages:**
- ✅ Start message generation
- ✅ Followup probability checks
- ✅ Inactivity triggers
- ✅ Backchannel messages

**Goal Evaluation:**
- ✅ Goal progress tracking
- ✅ Evidence collection
- ✅ Confidence scoring
- ✅ Status transitions (not_started → in_progress → achieved)

**Integration Points:**
- ✅ RAG microservice integration
- ✅ Transformers microservice integration
- ✅ Database persistence
- ✅ Session management

#### DeepEval Features

When `CONFIDENT_API_KEY` is set, tests use DeepEval's conversation simulator to:

1. **Generate realistic user responses** based on scenario descriptions
2. **Simulate full conversations** with your AI persona
3. **Evaluate conversation quality** and goal achievement
4. **Test edge cases** automatically

Example DeepEval test:
```typescript
const scenario = new ConversationalGolden({
  scenario: 'A candidate wants to demonstrate their technical skills during a job interview.',
  expectedOutcome: 'Successful coverage of background, skills, and experience.',
  userDescription: 'Experienced software engineer, eager to showcase accomplishments.',
});

const simulator = new ConversationSimulator({ modelCallback });
const testCases = await simulator.simulate({
  conversationalGoldens: [scenario],
  maxUserSimulations: 5,
});
```

#### Debugging Tests

**View detailed logs:**
```bash
pnpm --filter careersim-backend run langgraph:test:deepeval -- --verbose
```

**Run single test:**
```bash
pnpm --filter careersim-backend run langgraph:test:deepeval -- --testNamePattern="should handle a simple multi-turn conversation"
```

**Skip DeepEval tests during development:**
```bash
# Remove CONFIDENT_API_KEY from .env temporarily
# Only 9 core tests will run
```

#### Troubleshooting

**Error: "No simulations available"**
```bash
# Solution: Seed the database
pnpm --filter careersim-backend run db:seed
```

**Error: "Server is not healthy"**
```bash
# Solution: Start standalone server
pnpm --filter careersim-backend langgraph:server
```

**Error: "Please provide a valid Confident AI API Key"**
```bash
# Solution: This is expected if CONFIDENT_API_KEY is not set
# 9/13 tests will still pass
# To enable all tests, add to .env:
CONFIDENT_API_KEY=your-api-key-here
```

**Tests timing out:**
- Check LLM API response times
- Verify network connectivity
- Consider reducing `maxUserSimulations` in tests

#### CI/CD Integration

```yaml
# Example GitHub Actions workflow
- name: Run LangGraph Tests
  run: |
    pnpm --filter careersim-backend run db:seed
    pnpm --filter careersim-backend langgraph:server &
    sleep 10
    pnpm --filter careersim-backend run langgraph:test:deepeval
  env:
    CONFIDENT_API_KEY: ${{ secrets.CONFIDENT_API_KEY }}
```

#### Unit Testing Example

For unit testing individual components:

```typescript
import { buildConversationGraph } from '@/services/langgraph';

describe('ConversationGraph', () => {
  it('should handle user message', async () => {
    const graph = buildConversationGraph().compile();
    const result = await graph.invoke({
      sessionId: 'test-123',
      userId: 'user-456',
      userMessage: 'Hello',
    });
    expect(result.lastAiMessage).toBeDefined();
  });
});
```

#### Test Scenarios

The test suite includes 10 predefined conversation scenarios:

1. **Basic Conversation** - Simple multi-turn dialogue
2. **Goal Achievement** - Progressing through interview milestones
3. **Proactive Start** - AI-initiated conversations
4. **Followup Handling** - Handling brief user responses
5. **Complex Multi-Goal** - Comprehensive simulation coverage
6. **Difficult Questions** - Challenging Q&A scenarios
7. **Emotional Intelligence** - Testing emotional dynamics
8. **Rapport Building** - Relationship development
9. **Uncertainty Handling** - Unknown information scenarios
10. **Career Transition** - Complex narrative discussions

See `tests/scenarios.ts` for scenario definitions and customization.

## Contributing

When adding new nodes:
1. Create node function in appropriate `nodes/` file
2. Add node to graph in `graph.ts`
3. Wire up edges (conditional or standard)
4. Update state schema if needed
5. Export from `index.ts`

## Support

For issues or questions:
- Check LangSmith traces for debugging
- Review checkpoint history for state issues
- Enable verbose logging with `NODE_ENV=development`

