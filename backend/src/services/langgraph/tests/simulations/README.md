# End-to-End Simulation Tests

Comprehensive test suite for all 7 CareerSIM simulations with detailed evaluation and eloquent console logging.

## Overview

This directory contains end-to-end tests for each simulation, with:
- **Up to 50 turns** per simulation (stops early when all goals achieved)
- **Realistic AI conversations** using OpenAI GPT-4.1 to generate user responses
- **Real-time goal tracking** after every turn
- **Automatic early stopping** when all goals are achieved
- **Evaluation against success criteria** (communication, problem-solving, emotional)
- **Comprehensive logging** to follow every step in console output

## Test Files

| Test File | Simulation | Persona | Difficulty | Max Turns | Stops Early? |
|-----------|------------|---------|------------|-----------|--------------|
| `behavioral-interview.spec.ts` | Behavioral Interview | Brenda Vance | Intermediate | 50 | ✅ Yes |
| `data-analyst-interview.spec.ts` | Data Analyst Interview | Priya Patel | Intermediate | 50 | ✅ Yes |
| `tech-cultural-fit.spec.ts` | Tech & Cultural Fit | Alex Chen | Beginner | 50 | ✅ Yes |
| `pitching-idea.spec.ts` | Pitching Your Idea | David Miller | Advanced | 50 | ✅ Yes |
| `saying-no.spec.ts` | Saying "No" to Extra Work | Sarah Jenkins | Beginner | 50 | ✅ Yes |
| `reengaging-employee.spec.ts` | Re-engaging Employee | Michael Reyes | Expert | 50 | ✅ Yes |
| `delegating-task.spec.ts` | Delegating a Task | Chloe Davis | Intermediate | 50 | ✅ Yes |

## Running Tests

### Prerequisites

1. **Seed the database:**
   ```bash
   pnpm --filter careersim-backend run db:seed
   ```

2. **Ensure you have OpenAI API key set:**
   ```bash
   export OPENAI_API_KEY=your-key-here
   ```

### Run All Simulations

```bash
pnpm --filter careersim-backend run test:sim:all
```

### Run Individual Simulations

```bash
# Behavioral Interview (Brenda Vance)
pnpm --filter careersim-backend run test:sim:behavioral

# Data Analyst Interview (Priya Patel)
pnpm --filter careersim-backend run test:sim:data-analyst

# Tech & Cultural Fit (Alex Chen)
pnpm --filter careersim-backend run test:sim:tech-fit

# Pitching Your Idea (David Miller)
pnpm --filter careersim-backend run test:sim:pitching

# Saying "No" (Sarah Jenkins)
pnpm --filter careersim-backend run test:sim:saying-no

# Re-engaging Employee (Michael Reyes)
pnpm --filter careersim-backend run test:sim:reengaging

# Delegating Task (Chloe Davis)
pnpm --filter careersim-backend run test:sim:delegating
```

## Console Output

### Logging Highlights

The tests feature **eloquent, step-by-step logging** so you can follow the entire test execution:

#### 1. Test Suite Setup
```
═══════════════════════════════════════════════════════════════════════════════
🚀 BEHAVIORAL INTERVIEW TEST SUITE - SETUP
═══════════════════════════════════════════════════════════════════════════════
Setting up test environment...

📡 Starting standalone LangGraph server...
⏳ Waiting for server to be ready...
✅ Server is ready

🗄️  Checking database seed status...
✅ Database is seeded and ready

═══════════════════════════════════════════════════════════════════════════════
✅ TEST ENVIRONMENT READY
═══════════════════════════════════════════════════════════════════════════════
```

#### 2. Individual Test Header
```
╔══════════════════════════════════════════════════════════════════════════════╗
║ TEST 1: Complete Behavioral Interview Simulation                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

#### 3. Simulation Loading
```
📥 Loading simulation from database...
   Slug: behavioral-interview-brenda
   Found 7 total simulations in database
   ✅ Simulation loaded: "The Behavioral Interview"
   Difficulty: 2
   Persona: Brenda Vance
   Goals: 5
```

#### 4. Session Creation
```
🔧 Creating test session...
   Simulation ID: abc-123
   Persona ID: xyz-789
   ✅ Session created successfully
   Session ID: session-123
   Thread ID: thread-456
```

#### 5. Test Execution
```
════════════════════════════════════════════════════════════════════════════════
🎬 STARTING SIMULATION TEST
════════════════════════════════════════════════════════════════════════════════
📋 Simulation: The Behavioral Interview
👤 Persona: Brenda Vance (By-the-Book HR Manager)
🎯 Target Turns: 18
🔗 Session ID: session-123
🧵 Thread ID: thread-456
════════════════════════════════════════════════════════════════════════════════

🔗 Setting up conversation pipeline...
   ✅ Model callback configured

🤖 Initializing DeepEval conversation simulator...
   ✅ Simulator ready

🔄 RUNNING 18-TURN CONVERSATION SIMULATION
────────────────────────────────────────────────────────────────────────────────
   This will simulate a realistic conversation with the AI persona.
   Each turn represents a user message and AI response cycle.
   Please wait, this may take several minutes...
```

#### 6. Conversation Completion
```
────────────────────────────────────────────────────────────────────────────────
✅ CONVERSATION COMPLETED
   Total Turns: 18
   Duration: 125.3s
   Avg per turn: 7.0s
────────────────────────────────────────────────────────────────────────────────
```

#### 7. Evaluation Phase
```
📊 EVALUATING CONVERSATION QUALITY
────────────────────────────────────────────────────────────────────────────────

1️⃣  Evaluating Success Criteria...
   Analyzing communication, problem-solving, and emotional aspects...
   ✅ Success criteria evaluated: 78.5%

2️⃣  Evaluating Goal Progress...
   Checking achievement of conversation goals...
   ✅ Goals analyzed: 2 achieved, 3 in progress

3️⃣  Calculating Overall Score...
   Weighting: 40% success criteria + 60% goal achievement...
   ✅ Overall score calculated: 82.3%

4️⃣  Generating Evaluation Report...
   ✅ Report generated
```

#### 8. Conversation Sample
```
💬 CONVERSATION SAMPLE (First 10 Turns)
────────────────────────────────────────────────────────────────────────────────

👤 User (Turn 1/18):
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
Hello! I'm excited to interview for this position. Thank you for taking the 
time to meet with me today.

🤖 AI (Turn 2/18):
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
Good afternoon. Thank you for coming in. Let's get started. Can you walk me 
through your most recent position and what brought you here today?
```

#### 9. Detailed Evaluation Report
```
═══════════════════════════════════════════════════════════════════════════════
📊 EVALUATION REPORT
═══════════════════════════════════════════════════════════════════════════════
Simulation: behavioral-interview-brenda
Status: ✅ PASSED
Overall Score: 82.3%

Turn Count: 18

Success Criteria: 78.5%
  - Communication: 3/3
  - Problem Solving: 2/3
  - Emotional: 2/2

Goal Achievement:
  - Required: 2/2 (100%)
  - Optional: 3/3 (100%)
═══════════════════════════════════════════════════════════════════════════════

📋 DETAILED SUCCESS CRITERIA BREAKDOWN
────────────────────────────────────────────────────────────────────────────────

🗣️  Communication Criteria:
   1. ✅ Clear and structured responses
      Confidence: [████████░░] 85%
      Evidence: Found in 3 turn(s)
   2. ✅ Professional tone
      Confidence: [██████████] 95%
      Evidence: Found in 4 turn(s)
   3. ✅ Active listening
      Confidence: [██████░░░░] 65%
      Evidence: Found in 2 turn(s)

🧩 Problem Solving Criteria:
   1. ✅ STAR method usage
      Confidence: [███████░░░] 72%
      Evidence: Found in 2 turn(s)
   2. ❌ Relevant examples
      Confidence: [████░░░░░░] 45%
      Evidence: Found in 1 turn(s)
   3. ✅ Addressing concerns
      Confidence: [████████░░] 80%
      Evidence: Found in 3 turn(s)

❤️  Emotional Criteria:
   1. ✅ Confidence building
      Confidence: [████████░░] 78%
      Evidence: Found in 2 turn(s)
   2. ✅ Empathy for interviewer pressure
      Confidence: [██████░░░░] 68%
      Evidence: Found in 1 turn(s)

────────────────────────────────────────────────────────────────────────────────

🎯 CONVERSATION GOALS PROGRESS
────────────────────────────────────────────────────────────────────────────────

✦ Required Goals:
   ✅ Achieved Goal 5: Professional Closing
      Progress: [██████████] 95%

✧ Optional Goals:
   🔄 In Progress Goal 1: Opening and Rapport Building
      Progress: [███████░░░] 75%
   ✅ Achieved Goal 2: Behavioral Question Response
      Progress: [█████████░] 88%
   🔄 In Progress Goal 3: Addressing Concerns
      Progress: [██████░░░░] 62%
   🔄 In Progress Goal 4: Thoughtful Questions
      Progress: [█████░░░░░] 55%
```

#### 10. Validation
```
🔍 VALIDATING TEST RESULTS
────────────────────────────────────────────────────────────────────────────────

✓ Checking overall score threshold...
   Required: 70%
   Actual: 82.3%
   ✅ PASSED: Score meets minimum threshold

✓ Checking goal achievement threshold...
   Required: 70%
   Actual: 100.0% (2/2 required goals)
   ✅ PASSED: Goal achievement meets minimum threshold

────────────────────────────────────────────────────────────────────────────────
✅ ALL ASSERTIONS PASSED - SIMULATION SUCCESSFUL
────────────────────────────────────────────────────────────────────────────────
```

## Evaluation Metrics

### Overall Score Calculation
- **40%** Success Criteria (communication + problem-solving + emotional)
- **60%** Goal Achievement (required goals weighted 80%, optional goals 20%)

### Pass Threshold
- **Overall Score:** ≥ 70%
- **Goal Achievement:** ≥ 70% of required goals

## Test Structure

Each test file contains:
1. **Main test** - Complete N-turn simulation with full evaluation
2. **Focused tests** - 2-3 tests targeting specific goals or criteria

## Troubleshooting

### Server Connection Issues
If you see connection errors:
```bash
# Check if server is already running
lsof -i :8123

# Kill existing server if needed
kill -9 $(lsof -t -i:8123)
```

### Database Not Seeded
```bash
# Force reset and seed
pnpm --filter careersim-backend run db:seed:force
```

### Long Test Duration
- Each simulation can take **2-10 minutes** depending on turn count
- Total test suite runtime: **30-60 minutes** for all 7 simulations
- Use individual test scripts for faster iteration

## Architecture

```
tests/simulations/
├── README.md                          # This file
├── behavioral-interview.spec.ts       # Brenda Vance tests
├── data-analyst-interview.spec.ts     # Priya Patel tests
├── tech-cultural-fit.spec.ts          # Alex Chen tests
├── pitching-idea.spec.ts              # David Miller tests
├── saying-no.spec.ts                  # Sarah Jenkins tests
├── reengaging-employee.spec.ts        # Michael Reyes tests
└── delegating-task.spec.ts            # Chloe Davis tests

tests/
├── simulation.spec.ts                 # DeepEval conversation tests (13 cases)
├── evaluation.ts                      # Evaluation framework
├── direct-conversation.ts             # Direct conversation runner with OpenAI user generation
├── simulation-helpers.ts              # Test utilities with logging
└── helpers.ts                         # Base test helpers
```

## Contributing

When adding new tests:
1. Use the existing test files as templates
2. Add detailed console logging at each major step
3. Include test headers with box drawing characters
4. Add comprehensive assertions for goals and criteria
5. Document the expected turn count and difficulty

## Notes

- Tests use **OpenAI GPT-4.1** to generate realistic, contextual user messages
- The AI persona responses are generated by the actual LangGraph conversation system
- **Goal progress is tracked after every turn** and displayed in real-time
- **Tests automatically stop when all goals are achieved** (intelligent early stopping)
- Success criteria are heuristically evaluated based on keyword matching
- All tests run with `--detectOpenHandles` to catch async cleanup issues
- No external dependencies (DeepEval) - just OpenAI + your LangGraph system

---

## License

This project is licensed under the MIT License -- see the [LICENSE.md](../../../../../../LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
