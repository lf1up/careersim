#!/bin/bash
# Run All LangGraph Debug Tests
# 
# This script runs all debug tests in sequence to verify the graph is working correctly.
# 
# Usage:
#   ./src/services/langgraph/scripts/run-all-tests.sh
#   
# Or with pnpm:
#   pnpm debug:graph:all

set -e  # Exit on error

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 LangGraph Complete Test Suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Compilation
echo "📋 Test 1/6: Compilation Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pnpm debug:graph:compile
echo ""
read -p "Press Enter to continue to next test..."
echo ""

# Test 2: Visualization
echo "📋 Test 2/6: Visualization"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pnpm debug:graph:visualize
echo ""
read -p "Press Enter to continue to next test..."
echo ""

# Test 3: Basic Invocation
echo "📋 Test 3/6: Basic Invocation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pnpm debug:graph:invoke -- --message "Hello, I need help preparing for an interview"
echo ""
read -p "Press Enter to continue to next test..."
echo ""

# Test 4: Streaming
echo "📋 Test 4/6: Streaming Execution"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pnpm debug:graph:stream -- --message "What are good strategies for behavioral questions?"
echo ""
read -p "Press Enter to continue to next test..."
echo ""

# Test 5: Proactive Start
echo "📋 Test 5/6: Proactive Start Message"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pnpm debug:graph:proactive -- --type start
echo ""
read -p "Press Enter to continue to final test..."
echo ""

# Test 6: Proactive Inactivity
echo "📋 Test 6/6: Proactive Inactivity Nudge"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pnpm debug:graph:proactive -- --type inactivity
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All Tests Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Summary:"
echo "  ✅ Compilation successful"
echo "  ✅ Visualization generated"
echo "  ✅ Basic invocation working"
echo "  ✅ Streaming working"
echo "  ✅ Proactive messages working"
echo ""
echo "The LangGraph system is fully operational! 🚀"
echo ""
echo "Next steps:"
echo "  • Enable USE_LANGGRAPH=true in your .env"
echo "  • Integrate into routes (see README.md)"
echo "  • Deploy to production when ready"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

