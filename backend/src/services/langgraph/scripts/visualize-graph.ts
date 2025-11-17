#!/usr/bin/env ts-node
/**
 * Visualization Script: Display Graph Structure
 * 
 * This script generates a visual representation of the conversation graph structure.
 * 
 * Usage:
 *   ts-node src/services/langgraph/scripts/visualize-graph.ts [--format text|mermaid]
 *   
 * Or with pnpm:
 *   pnpm debug:graph:visualize
 */

import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenvConfig({ path: path.resolve(__dirname, '../../../../.env') });

// Disable LangSmith tracing during debug
process.env.LANGCHAIN_TRACING_V2 = 'false';

// Define NODE_NAMES locally to avoid importing and triggering TypeORM initialization
const NODE_NAMES = {
  PROCESS_USER_INPUT: 'process_user_input',
  FETCH_RAG_CONTEXT: 'fetch_rag_context',
  GENERATE_AI_RESPONSE: 'generate_ai_response',
  ANALYZE_RESPONSE: 'analyze_response',
  EVALUATE_GOALS: 'evaluate_goals',
  CHECK_PROACTIVE_TRIGGER: 'check_proactive_trigger',
  GENERATE_PROACTIVE_MESSAGE: 'generate_proactive_message',
  PERSIST_AND_EMIT: 'persist_and_emit',
  SCHEDULE_INACTIVITY: 'schedule_inactivity',
} as const;

/**
 * Get output format from command line
 */
function getOutputFormat(): 'text' | 'mermaid' {
  const formatIndex = process.argv.indexOf('--format');
  if (formatIndex !== -1 && process.argv[formatIndex + 1]) {
    const format = process.argv[formatIndex + 1];
    if (format === 'mermaid') {
      return 'mermaid';
    }
  }
  return 'text';
}

/**
 * Generate text visualization
 */
function visualizeAsText() {
  console.log('\n🔍 LangGraph Structure Visualization (Text Format)\n');
  console.log('━'.repeat(80));
  
  console.log('\n📊 Graph Flow:\n');
  console.log(`  START`);
  console.log(`    ↓`);
  console.log(`  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${NODE_NAMES.PROCESS_USER_INPUT.padEnd(59)}│`);
  console.log(`  │ • Loads session and user data                               │`);
  console.log(`  │ • Adds user message to conversation state                   │`);
  console.log(`  └─────────────────────────────────────────────────────────────┘`);
  console.log(`    ↓`);
  console.log(`  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${NODE_NAMES.FETCH_RAG_CONTEXT.padEnd(59)}│`);
  console.log(`  │ • Queries RAG microservice for relevant knowledge           │`);
  console.log(`  │ • Adds grounding context to state                           │`);
  console.log(`  └─────────────────────────────────────────────────────────────┘`);
  console.log(`    ↓`);
  console.log(`  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${NODE_NAMES.GENERATE_AI_RESPONSE.padEnd(59)}│`);
  console.log(`  │ • Generates persona-based response using ChatOpenAI         │`);
  console.log(`  │ • Uses system prompt with persona/RAG context               │`);
  console.log(`  └─────────────────────────────────────────────────────────────┘`);
  console.log(`    ↓`);
  console.log(`  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${NODE_NAMES.ANALYZE_RESPONSE.padEnd(59)}│`);
  console.log(`  │ • Calls Transformers microservice                           │`);
  console.log(`  │ • Analyzes emotion, sentiment, quality                      │`);
  console.log(`  └─────────────────────────────────────────────────────────────┘`);
  console.log(`    ↓`);
  console.log(`  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${NODE_NAMES.EVALUATE_GOALS.padEnd(59)}│`);
  console.log(`  │ • Uses LangChain tools to assess goal achievement           │`);
  console.log(`  │ • Updates goal progress with evidence                       │`);
  console.log(`  └─────────────────────────────────────────────────────────────┘`);
  console.log(`    ↓`);
  console.log(`  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${NODE_NAMES.CHECK_PROACTIVE_TRIGGER.padEnd(59)}│`);
  console.log(`  │ • Determines if proactive message needed                    │`);
  console.log(`  │ • Checks for backchannel, follow-up triggers                │`);
  console.log(`  └─────────────────────────────────────────────────────────────┘`);
  console.log(`    ↓`);
  console.log(`  [CONDITIONAL ROUTING]`);
  console.log(`    ├─ If proactive needed → ${NODE_NAMES.GENERATE_PROACTIVE_MESSAGE}`);
  console.log(`    └─ Otherwise → ${NODE_NAMES.PERSIST_AND_EMIT}`);
  console.log(`    ↓`);
  console.log(`  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${NODE_NAMES.PERSIST_AND_EMIT.padEnd(59)}│`);
  console.log(`  │ • Saves messages to database                                │`);
  console.log(`  │ • Emits via Socket.IO to frontend                           │`);
  console.log(`  └─────────────────────────────────────────────────────────────┘`);
  console.log(`    ↓`);
  console.log(`  [CONDITIONAL ROUTING]`);
  console.log(`    ├─ If needs inactivity schedule → ${NODE_NAMES.SCHEDULE_INACTIVITY}`);
  console.log(`    └─ Otherwise → END`);
  console.log(`    ↓`);
  console.log(`  END`);
  
  console.log('\n━'.repeat(80));
  console.log('\n📋 Node Summary:\n');
  
  const nodeDescriptions = {
    [NODE_NAMES.PROCESS_USER_INPUT]: 'Session loading and message processing',
    [NODE_NAMES.FETCH_RAG_CONTEXT]: 'Knowledge retrieval from RAG service',
    [NODE_NAMES.GENERATE_AI_RESPONSE]: 'AI response generation with ChatOpenAI',
    [NODE_NAMES.ANALYZE_RESPONSE]: 'Emotion, sentiment, and quality analysis',
    [NODE_NAMES.EVALUATE_GOALS]: 'Goal achievement evaluation with tools',
    [NODE_NAMES.CHECK_PROACTIVE_TRIGGER]: 'Proactive message trigger detection',
    [NODE_NAMES.GENERATE_PROACTIVE_MESSAGE]: 'Proactive message generation',
    [NODE_NAMES.PERSIST_AND_EMIT]: 'Database persistence and Socket.IO emission',
    [NODE_NAMES.SCHEDULE_INACTIVITY]: 'Schedule next inactivity nudge',
  };
  
  Object.entries(nodeDescriptions).forEach(([name, description], index) => {
    console.log(`  ${index + 1}. ${name}`);
    console.log(`     ${description}`);
  });
  
  console.log('\n━'.repeat(80));
}

/**
 * Generate Mermaid diagram
 */
function visualizeAsMermaid() {
  console.log('\n🔍 LangGraph Structure Visualization (Mermaid Format)\n');
  console.log('━'.repeat(80));
  console.log('\nCopy and paste this into https://mermaid.live or your docs:\n');
  console.log('```mermaid');
  console.log('graph TD');
  console.log('    Start([START]) --> A[process_user_input]');
  console.log('    A --> B[fetch_rag_context]');
  console.log('    B --> C[generate_ai_response]');
  console.log('    C --> D[analyze_response]');
  console.log('    D --> E[evaluate_goals]');
  console.log('    E --> F[check_proactive_trigger]');
  console.log('    F -->|Proactive Needed| G[generate_proactive_message]');
  console.log('    F -->|No Proactive| H[persist_and_emit]');
  console.log('    G --> H');
  console.log('    H -->|Needs Schedule| I[schedule_inactivity]');
  console.log('    H -->|No Schedule| End([END])');
  console.log('    I --> End');
  console.log('    ');
  console.log('    style Start fill:#90EE90');
  console.log('    style End fill:#FFB6C1');
  console.log('    style A fill:#87CEEB');
  console.log('    style B fill:#87CEEB');
  console.log('    style C fill:#FFD700');
  console.log('    style D fill:#87CEEB');
  console.log('    style E fill:#DDA0DD');
  console.log('    style F fill:#FFA07A');
  console.log('    style G fill:#FFD700');
  console.log('    style H fill:#98FB98');
  console.log('    style I fill:#87CEEB');
  console.log('```');
  console.log('\n━'.repeat(80));
}

/**
 * Main visualization function
 */
function visualizeGraph() {
  const format = getOutputFormat();
  
  if (format === 'mermaid') {
    visualizeAsMermaid();
  } else {
    visualizeAsText();
  }
  
  console.log('\n💡 Tips:');
  console.log('  • Use --format text for console output (default)');
  console.log('  • Use --format mermaid for Mermaid diagram');
  console.log('  • Mermaid diagrams can be rendered at https://mermaid.live');
  console.log('\n━'.repeat(80));
}

// Run the visualization
visualizeGraph();

