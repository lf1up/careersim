// Test script to demonstrate the new professional NLP capabilities
// Run with: node test-nlp.js

import { AIService } from './dist/services/ai.js';
import { transformersAvailable, fallbackMessage } from './dist/config/transformers.js';

async function testNLP() {
  console.log('🚀 Testing Professional NLP with Docker-Compatible Configuration\n');
  
  // Check if Transformers.js loaded successfully
  console.log(`🔍 Transformers.js available: ${transformersAvailable ? '✅ YES' : '❌ NO'}`);
  if (!transformersAvailable) {
    console.log(`📝 Fallback reason: ${fallbackMessage}\n`);
    console.log('🔄 Testing will use fallback keyword-based analysis\n');
  } else {
    console.log('✅ Professional NLP models will be used\n');
  }
  
  const testTexts = [
    "I'm absolutely thrilled about this opportunity!",
    "This is quite disappointing and frustrating to deal with.",
    "The weather is nice today.",
    "I'm feeling a bit anxious about the presentation tomorrow.",
    "That was an amazing performance, I'm so proud!",
    "I hate dealing with these technical issues.",
    "Let me think about this carefully before deciding.",
    "Wow, that's incredible! I didn't expect such great results."
  ];

  try {
    // Create AIService instance (WASM configuration already done at import)
    const aiService = new AIService();
    
    console.log('🤖 Loading professional NLP models (WASM backend)...\n');
    
    for (const text of testTexts) {
      console.log(`📝 Text: "${text}"`);
      
      // Test the new professional NLP
      try {
        const startTime = Date.now();
        const [emotion, sentiment] = await Promise.all([
          aiService.analyzeEmotionalTone(text, { name: 'Test' }),
          aiService.analyzeSentiment(text)
        ]);
        const processingTime = Date.now() - startTime;
        
        console.log(`   🎭 Emotion: ${emotion}`);
        console.log(`   😊 Sentiment: ${sentiment}`);
        console.log(`   ⚡ Processing time: ${processingTime}ms`);
        
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        console.log(`   🔍 Stack: ${error.stack}`);
      }
      
      console.log('');
    }
    
    console.log('✅ NLP test completed!\n');
    
    if (transformersAvailable) {
      console.log('🎉 Used state-of-the-art BERT and RoBERTa models for professional analysis!');
      console.log('🐳 Running with WASM backend - Docker compatible, no native dependencies');
    } else {
      console.log('📝 Used fallback keyword-based analysis (Transformers.js not available)');
      console.log('🔧 Professional NLP will be available once Docker/ONNX issues are resolved');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('🔍 Full error:', error.stack);
  }
}

// Run the test
testNLP().catch(console.error);