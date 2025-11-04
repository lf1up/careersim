# LangGraph DeepEval End-to-End Tests

Comprehensive test suite for the LangGraph conversation system using DeepEval's TypeScript SDK.

## Overview

This test suite provides end-to-end testing of the LangGraph conversation system, including:

- ✅ **Basic Conversation Flow** - Multi-turn conversations with state persistence
- ✅ **Proactive Messages** - AI-initiated messages (start, followup, inactivity)
- ✅ **Goal Tracking** - Conversation goal evaluation and progress tracking
- ✅ **Turn Management** - Proper alternation between user and AI turns
- ✅ **Response Analysis** - Sentiment and emotional analysis integration
- ✅ **State Persistence** - Conversation state checkpointing
- ⚠️ **DeepEval Integration** - Requires Confident AI API key

## Test Results

### ✅ Passing Tests (9/13)

All core functionality tests pass:

- Simple multi-turn conversations
- Conversation state persistence
- Proactive start messages
- Followup triggers
- Goal progress tracking
- Turn alternation
- Sentiment/emotion analysis
- Empty message handling
- State persistence

### ⚠️ DeepEval Simulator Tests (4/13 - Requires API Key)

The DeepEval conversation simulator tests require a **Confident AI API key** to generate synthetic user responses:

- Basic conversation simulation
- Goal achievement simulation  
- Proactive start simulation
- Multi-scenario batch testing

To enable these tests, set the `CONFIDENT_AI_API_KEY` environment variable:

```bash
export CONFIDENT_AI_API_KEY="your-api-key-here"
```

You can obtain an API key from [Confident AI](https://confident-ai.com/).

## Running the Tests

### Prerequisites

1. **Database must be seeded:**
   ```bash
   pnpm --filter careersim-backend run db:seed
   ```

2. **Standalone server must be running:**
   ```bash
   # In one terminal
   pnpm --filter careersim-backend langgraph:server
   
   # Or the tests will start it automatically
   ```

### Run All Tests

```bash
pnpm --filter careersim-backend run langgraph:test:deepeval
```

### Run Specific Tests

```bash
# Run only basic conversation tests
pnpm --filter careersim-backend run langgraph:test:deepeval -- --testNamePattern="Basic Conversation"

# Run only proactive message tests
pnpm --filter careersim-backend run langgraph:test:deepeval -- --testNamePattern="Proactive Message"

# Run DeepEval integration tests (requires API key)
pnpm --filter careersim-backend run langgraph:test:deepeval -- --testNamePattern="DeepEval"
```

### Run with Verbose Output

```bash
pnpm --filter careersim-backend run langgraph:test:deepeval -- --verbose
```

## Test Structure

### Files

- **`simulation.spec.ts`** - Main test suite with all test cases
- **`helpers.ts`** - Test utilities and helper functions
- **`scenarios.ts`** - ConversationalGolden scenario definitions

### Test Categories

#### 1. Basic Conversation Flow
Tests normal user-AI message exchanges with state persistence.

#### 2. Proactive Message Generation
Tests AI-initiated messages:
- **Start**: AI opens the conversation
- **Followup**: AI asks follow-up questions
- **Inactivity**: AI sends nudges after user inactivity

#### 3. Goal Tracking and Evaluation
Tests the goal evaluation system that tracks conversation progress against simulation objectives.

#### 4. Turn Management
Verifies proper alternation between user and AI turns.

#### 5. Response Analysis
Tests integration with the transformer service for sentiment and emotion analysis.

#### 6. Error Handling
Tests graceful handling of edge cases like empty messages.

#### 7. DeepEval Conversation Simulator
Tests using DeepEval's conversation simulator to generate synthetic multi-turn conversations.

#### 8. State Persistence
Verifies that conversation state is properly persisted across turns.

## Test Configuration

### Timeouts

Tests have extended timeouts due to LLM response times:
- Individual test: 240 seconds (4 minutes)
- Setup/teardown: 30 seconds
- Batch tests: 720 seconds (12 minutes)

### Environment Variables

- `LANGGRAPH_SERVER_URL` - Override server URL (default: `http://localhost:8123`)
- `CONFIDENT_AI_API_KEY` - Required for DeepEval simulator tests

## Architecture

### Test Flow

1. **Global Setup** (`beforeAll`)
   - Start standalone server (if not running)
   - Verify database is seeded
   - Wait for server to be ready

2. **Per-Test Setup** (`beforeEach`)
   - Create fresh simulation session
   - Initialize test context

3. **Test Execution**
   - Invoke graph via standalone server API
   - Verify responses and state
   - Check goal progress and metadata

4. **Per-Test Cleanup** (`afterEach`)
   - Mark session for cleanup
   - Database rollback handles actual cleanup

5. **Global Cleanup** (`afterAll`)
   - Stop standalone server (if started by tests)

### Helper Functions

- `startStandaloneServer()` - Start or verify server is running
- `setupTestSession()` - Create a new test session
- `invokeGraph()` - Send a message to the graph
- `invokeGraphWithTrigger()` - Trigger proactive messages
- `createModelCallback()` - Create DeepEval model callback
- `getSessionDetails()` - Fetch session state

### Test Scenarios

The `scenarios.ts` file defines 10+ ConversationalGolden scenarios:

1. **Basic Conversation** - Simple multi-turn dialogue
2. **Goal Achievement** - Progressing through milestones
3. **Proactive Start** - AI-initiated conversation
4. **Followup** - Handling brief responses
5. **Complex Multi-Goal** - Comprehensive simulation
6. **Difficult Questions** - Challenging Q&A
7. **Emotional Intelligence** - Emotional dynamics
8. **Rapport Building** - Relationship development
9. **Uncertainty Handling** - Unknown information
10. **Career Transition** - Complex narratives

## Interpreting Results

### Successful Test Output

```
✓ should handle a simple multi-turn conversation (107313 ms)
✓ should maintain conversation state across turns (93262 ms)
```

### DeepEval API Key Error

```
✕ should simulate a basic conversation with DeepEval (31 ms)
  Please provide a valid Confident AI API Key.
```

**Solution**: Set `CONFIDENT_AI_API_KEY` environment variable

### Goal Progress Output

```javascript
Goal progress: [
  {
    goalNumber: 1,
    title: 'Dataset Understanding and Assumptions',
    status: 'not_started',
    confidence: 0
  },
  {
    goalNumber: 5,
    title: 'Professional Closing',
    status: 'in_progress',
    confidence: 0.497
  }
]
```

## Integration with CI/CD

To integrate with your CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
- name: Run LangGraph Tests
  run: |
    pnpm --filter careersim-backend run db:seed
    pnpm --filter careersim-backend langgraph:server &
    sleep 10
    pnpm --filter careersim-backend run langgraph:test:deepeval
  env:
    CONFIDENT_AI_API_KEY: ${{ secrets.CONFIDENT_AI_API_KEY }}
```

## Troubleshooting

### Server Connection Error

**Error**: `Failed to fetch simulations`

**Solution**: Ensure standalone server is running on port 8123

### Database Not Seeded

**Error**: `No simulations available`

**Solution**: Run `pnpm --filter careersim-backend run db:seed`

### Timeout Errors

**Error**: Test timeout exceeded

**Solution**: 
- Check LLM API is responding
- Verify network connectivity
- Increase timeout in test configuration

### DeepEval Errors

**Error**: `Please provide a valid Confident AI API Key`

**Solution**: Tests work without DeepEval - only 4/13 tests require the API key

## Future Enhancements

- [ ] Add metrics-based evaluation using DeepEval metrics
- [ ] Implement custom goal achievement metrics
- [ ] Add performance benchmarking
- [ ] Create visual test reports
- [ ] Add conversation quality scoring
- [ ] Implement automated regression testing

## Resources

- [DeepEval Documentation](https://deepeval.com/docs/conversation-simulator)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [Confident AI](https://confident-ai.com/)

