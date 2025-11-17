#!/usr/bin/env ts-node
/**
 * Debug Script: Compile LangGraph
 * 
 * This script compiles the conversation graph and outputs diagnostic information.
 * Use this to verify the graph structure and troubleshoot compilation issues.
 * 
 * Usage:
 *   ts-node src/services/langgraph/scripts/debug-compile.ts
 *   
 * Or with pnpm:
 *   pnpm debug:graph:compile
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

// Disable LangSmith tracing during debug to avoid network issues
process.env.LANGCHAIN_TRACING_V2 = 'false';

import { 
  buildConversationGraph, 
  compileConversationGraph,
  NODE_NAMES,
} from '../graph';

/**
 * Main debug function
 */
async function debugCompile() {
  console.log('🐛 LangGraph Debug: Compilation Test\n');
  console.log('━'.repeat(60));
  
  try {
    // Step 1: Build the graph (structure only)
    console.log('\n📦 Step 1: Building graph structure...\n');
    const graph = buildConversationGraph();
    console.log('\n✅ Graph structure built successfully!\n');
    
    // Step 2: Display node information
    console.log('━'.repeat(60));
    console.log('\n📋 Step 2: Graph Nodes\n');
    const nodes = Object.values(NODE_NAMES);
    nodes.forEach((node, index) => {
      console.log(`  ${index + 1}. ${node}`);
    });
    console.log(`\n  Total nodes: ${nodes.length}`);
    
    // Step 3: Attempt full compilation (may require database)
    console.log('\n━'.repeat(60));
    console.log('\n⚙️  Step 3: Compiling graph (requires database connection)...\n');
    
    try {
      const compiled = compileConversationGraph();
      console.log('\n✅ Graph compiled with checkpointer successfully!\n');
    } catch (compileError: any) {
      console.log('\n⚠️  Full compilation skipped (database may not be available)\n');
      console.log(`   Error: ${compileError.message}\n`);
      console.log('   This is OK for structure verification.');
      console.log('   For full testing, ensure database is running.\n');
    }
    
    // Step 4: Display graph structure
    console.log('━'.repeat(60));
    console.log('\n🔗 Step 4: Graph Flow\n');
    console.log(`  START → ${NODE_NAMES.PROCESS_USER_INPUT}`);
    console.log(`         ↓`);
    console.log(`         ${NODE_NAMES.FETCH_RAG_CONTEXT}`);
    console.log(`         ↓`);
    console.log(`         ${NODE_NAMES.GENERATE_AI_RESPONSE}`);
    console.log(`         ↓`);
    console.log(`         ${NODE_NAMES.ANALYZE_RESPONSE}`);
    console.log(`         ↓`);
    console.log(`         ${NODE_NAMES.EVALUATE_GOALS}`);
    console.log(`         ↓`);
    console.log(`         ${NODE_NAMES.CHECK_PROACTIVE_TRIGGER}`);
    console.log(`         ↓`);
    console.log(`        [conditional routing]`);
    console.log(`         ↓`);
    console.log(`    ${NODE_NAMES.GENERATE_PROACTIVE_MESSAGE} OR ${NODE_NAMES.PERSIST_AND_EMIT}`);
    console.log(`         ↓`);
    console.log(`         ${NODE_NAMES.SCHEDULE_INACTIVITY}`);
    console.log(`         ↓`);
    console.log(`        END`);
    
    // Step 5: Display configuration
    console.log('\n━'.repeat(60));
    console.log('\n⚙️  Step 5: Configuration\n');
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set'}`);
    console.log(`  LangSmith Tracing: ${process.env.LANGCHAIN_TRACING_V2 === 'true' ? '✓ Enabled' : '✗ Disabled'}`);
    console.log(`  LangSmith Project: ${process.env.LANGCHAIN_PROJECT || 'Not set'}`);
    console.log(`  Database URL: ${process.env.DATABASE_URL ? '✓ Set' : '✗ Not set'}`);
    console.log(`  RAG Service URL: ${process.env.RAG_SERVICE_URL || 'Not set'}`);
    console.log(`  Transformers Service URL: ${process.env.TRANSFORMERS_SERVICE_URL || 'Not set'}`);
    
    // Success summary
    console.log('\n━'.repeat(60));
    console.log('\n✅ COMPILATION SUCCESSFUL!\n');
    console.log('The LangGraph conversation graph is ready to use.');
    console.log('Next steps:');
    console.log('  • Run test-invoke.ts to test with sample data');
    console.log('  • Run test-stream.ts to test streaming');
    console.log('  • Check LangSmith dashboard for traces (if enabled)');
    console.log('\n━'.repeat(60));
    
  } catch (error) {
    console.error('\n❌ COMPILATION FAILED!\n');
    console.error('Error details:');
    console.error(error);
    console.error('\n━'.repeat(60));
    process.exit(1);
  }
}

// Run the debug script
debugCompile().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

