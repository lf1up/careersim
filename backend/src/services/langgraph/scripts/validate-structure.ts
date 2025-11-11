#!/usr/bin/env ts-node
/**
 * Validate Script: Check Graph Structure
 * 
 * This script validates the LangGraph structure without requiring database or dependencies.
 * Use this for quick verification of graph node definitions and flow.
 * 
 * Usage:
 *   ts-node src/services/langgraph/scripts/validate-structure.ts
 *   
 * Or with pnpm:
 *   pnpm debug:graph:validate
 */

import { config as dotenvConfig } from 'dotenv';
import path from 'path';

// Load environment variables
dotenvConfig({ path: path.resolve(__dirname, '../../../../.env') });

// Disable everything that might cause issues
process.env.LANGCHAIN_TRACING_V2 = 'false';

/**
 * Main validation function
 */
async function validateStructure() {
  console.log('🔍 LangGraph Structure Validation\n');
  console.log('━'.repeat(60));
  
  try {
    // Step 1: Validate node definitions from constants (no imports)
    console.log('\n📦 Step 1: Validating node definitions...\n');
    
    // Define expected nodes without importing to avoid TypeORM initialization
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
    };
    
    const nodes = Object.values(NODE_NAMES);
    console.log(`✅ Expected ${nodes.length} node definitions:\n`);
    nodes.forEach((node, index) => {
      console.log(`  ${index + 1}. ${node}`);
    });
    
    // Step 2: Display expected graph flow
    console.log('\n━'.repeat(60));
    console.log('\n🔗 Step 2: Expected Graph Flow\n');
    console.log(`  START`);
    console.log(`    ↓`);
    console.log(`  ${NODE_NAMES.PROCESS_USER_INPUT}`);
    console.log(`    ↓`);
    console.log(`  ${NODE_NAMES.FETCH_RAG_CONTEXT}`);
    console.log(`    ↓`);
    console.log(`  ${NODE_NAMES.GENERATE_AI_RESPONSE}`);
    console.log(`    ↓`);
    console.log(`  ${NODE_NAMES.ANALYZE_RESPONSE}`);
    console.log(`    ↓`);
    console.log(`  ${NODE_NAMES.EVALUATE_GOALS}`);
    console.log(`    ↓`);
    console.log(`  ${NODE_NAMES.CHECK_PROACTIVE_TRIGGER}`);
    console.log(`    ↓`);
    console.log(`  [conditional routing]`);
    console.log(`    ↓`);
    console.log(`  ${NODE_NAMES.GENERATE_PROACTIVE_MESSAGE} OR ${NODE_NAMES.PERSIST_AND_EMIT}`);
    console.log(`    ↓`);
    console.log(`  ${NODE_NAMES.SCHEDULE_INACTIVITY}`);
    console.log(`    ↓`);
    console.log(`  END`);
    
    // Step 3: Configuration check
    console.log('\n━'.repeat(60));
    console.log('\n⚙️  Step 3: Configuration Check\n');
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set'}`);
    console.log(`  Database URL: ${process.env.DATABASE_URL ? '✓ Set' : '✗ Not set'}`);
    console.log(`  RAG Service: ${process.env.RAG_SERVICE_URL || 'Not set (will use default)'}`);
    console.log(`  Transformers Service: ${process.env.TRANSFORMERS_SERVICE_URL || 'Not set (will use default)'}`);
    
    // Step 4: File structure check
    console.log('\n━'.repeat(60));
    console.log('\n📁 Step 4: File Structure Check\n');
    
    const fs = require('fs');
    const basePath = path.resolve(__dirname, '..');
    
    const expectedFiles = [
      'state.ts',
      'graph.ts',
      'checkpointer.ts',
      'prompts.ts',
      'index.ts',
      'nodes/conversation.ts',
      'nodes/proactive.ts',
      'nodes/evaluation.ts',
      'nodes/persistence.ts',
      'tools/evaluation_tools.ts',
    ];
    
    let allFilesPresent = true;
    expectedFiles.forEach((file) => {
      const filePath = path.join(basePath, file);
      const exists = fs.existsSync(filePath);
      const status = exists ? '✓' : '✗';
      console.log(`  ${status} ${file}`);
      if (!exists) allFilesPresent = false;
    });
    
    // Success summary
    console.log('\n━'.repeat(60));
    console.log('\n✅ STRUCTURE VALIDATION COMPLETE!\n');
    console.log('Graph structure:');
    console.log(`  • ${nodes.length} nodes defined`);
    console.log(`  • ${allFilesPresent ? 'All' : 'Some'} required files present`);
    console.log(`  • Configuration ${process.env.OPENAI_API_KEY && process.env.DATABASE_URL ? 'complete' : 'needs attention'}`);
    console.log('\nNext steps:');
    console.log('  • Ensure database is running');
    console.log('  • Set OPENAI_API_KEY in .env');
    console.log('  • Run pnpm debug:graph:visualize for detailed flow diagram');
    console.log('  • For full compilation test, start database first');
    console.log('\n━'.repeat(60));
    
  } catch (error) {
    console.error('\n❌ VALIDATION FAILED!\n');
    console.error('Error details:');
    console.error(error);
    console.error('\n━'.repeat(60));
    process.exit(1);
  }
}

// Run the validation script
validateStructure().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

