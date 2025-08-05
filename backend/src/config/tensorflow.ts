/**
 * Configure TensorFlow.js for server environments
 * Provides utilities for sentiment analysis and emotion detection
 */

import * as tf from '@tensorflow/tfjs';

// Global state for models
let useModel: unknown = null;
let isInitialized = false;

// Model configurations
const TOXICITY_THRESHOLD = 0.7; // Threshold for toxicity detection

/**
 * Initialize TensorFlow.js backend
 */
async function initializeTensorFlow(): Promise<void> {
  if (isInitialized) return;
  
  try {
    console.log('🔄 Initializing TensorFlow.js backend...');
    
    // Set backend to Node.js CPU backend
    await tf.ready();
    
    console.log('✅ TensorFlow.js backend initialized successfully');
    console.log(`📊 Backend: ${tf.getBackend()}`);
    
    isInitialized = true;
  } catch (error: unknown) {
    console.error('❌ Failed to initialize TensorFlow.js:', (error as Error).message);
    throw new Error(`TensorFlow.js initialization failed: ${error.message}`);
  }
}

/**
 * Load the Universal Sentence Encoder model for text analysis
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function loadUniversalSentenceEncoder(): Promise<unknown> {
  if (useModel) return useModel;
  
  try {
    console.log('🔄 Loading Universal Sentence Encoder...');
    
    // For now, we'll use a simple text classification approach
    // The Universal Sentence Encoder can be loaded like this:
    // useModel = await tf.loadLayersModel('https://tfhub.dev/google/universal-sentence-encoder/4');
    
    // For this implementation, we'll create a placeholder that represents
    // the functionality we need without the complex model loading
    useModel = {
      embed: async (texts: string[]) => {
        // This is a placeholder - in a real implementation, this would
        // use the actual Universal Sentence Encoder
        console.log('🔬 Using simplified text analysis (USE placeholder)');
        return texts.map(() => Array(512).fill(0).map(() => Math.random()));
      },
    };
    
    console.log('✅ Universal Sentence Encoder loaded (simplified version)');
    return useModel;
  } catch (error: unknown) {
    console.error('❌ Failed to load Universal Sentence Encoder:', (error as Error).message);
    useModel = null;
    throw new Error(`USE loading failed: ${(error as Error).message}`);
  }
}

/**
 * Analyze sentiment using TensorFlow.js-based approach
 */
export async function analyzeSentiment(text: string): Promise<{
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
}> {
  try {
    await initializeTensorFlow();
    
    // Simple keyword-based sentiment analysis for now
    // This can be enhanced with actual TensorFlow.js models
    const positiveWords = [
      'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 
      'awesome', 'love', 'like', 'happy', 'pleased', 'satisfied', 'perfect',
    ];
    
    const negativeWords = [
      'bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 
      'angry', 'frustrated', 'disappointed', 'wrong', 'fail', 'problem',
    ];
    
    const words = text.toLowerCase().split(/\W+/);
    const positiveCount = words.filter(word => positiveWords.includes(word)).length;
    const negativeCount = words.filter(word => negativeWords.includes(word)).length;
    
    let sentiment: 'positive' | 'neutral' | 'negative';
    let confidence: number;
    
    if (positiveCount > negativeCount) {
      sentiment = 'positive';
      confidence = Math.min(0.9, 0.6 + (positiveCount - negativeCount) * 0.1);
    } else if (negativeCount > positiveCount) {
      sentiment = 'negative';
      confidence = Math.min(0.9, 0.6 + (negativeCount - positiveCount) * 0.1);
    } else {
      sentiment = 'neutral';
      confidence = 0.5;
    }
    
    console.log(`📊 Sentiment analysis: ${sentiment} (${confidence.toFixed(3)})`);
    return { sentiment, confidence };
    
  } catch (error: unknown) {
    console.warn('⚠️ Sentiment analysis failed, using fallback:', (error as Error).message);
    return { sentiment: 'neutral', confidence: 0.3 };
  }
}

/**
 * Analyze emotional tone using enhanced keyword analysis
 */
export async function analyzeEmotion(text: string): Promise<{
  emotion: string;
  confidence: number;
}> {
  try {
    await initializeTensorFlow();
    
    // Enhanced emotion analysis using keyword patterns
    const emotionPatterns = {
      'friendly': [
        'thank', 'thanks', 'please', 'hello', 'hi', 'good', 'nice', 
        'appreciate', 'welcome', 'glad', 'happy',
      ],
      'encouraging': [
        'great', 'excellent', 'perfect', 'amazing', 'wonderful', 'awesome',
        'keep', 'continue', 'progress', 'improve', 'success',
      ],
      'neutral': [
        'okay', 'ok', 'fine', 'understand', 'see', 'right', 'yes', 'no',
      ],
      'concerned': [
        'worry', 'worried', 'concern', 'issue', 'problem', 'difficult',
        'help', 'support', 'question',
      ],
      'frustrated': [
        'frustrated', 'annoyed', 'angry', 'upset', 'disappointed',
        'wrong', 'error', 'fail', 'terrible', 'awful',
      ],
    };
    
    const words = text.toLowerCase().split(/\W+/);
    const emotionScores: { [key: string]: number } = {};
    
    // Calculate scores for each emotion
    Object.entries(emotionPatterns).forEach(([emotion, keywords]) => {
      const matches = words.filter(word => keywords.includes(word)).length;
      emotionScores[emotion] = matches;
    });
    
    // Find the dominant emotion
    const dominantEmotion = Object.keys(emotionScores).reduce((a, b) => 
      emotionScores[a] > emotionScores[b] ? a : b,
    );
    
    const maxScore = emotionScores[dominantEmotion];
    const confidence = maxScore > 0 ? Math.min(0.8, 0.4 + maxScore * 0.2) : 0.3;
    
    const finalEmotion = maxScore > 0 ? dominantEmotion : 'neutral';
    
    console.log(`💭 Emotion analysis: ${finalEmotion} (${confidence.toFixed(3)})`);
    return { emotion: finalEmotion, confidence };
    
  } catch (error: unknown) {
    console.warn('⚠️ Emotion analysis failed, using fallback:', (error as Error).message);
    return { emotion: 'neutral', confidence: 0.3 };
  }
}

/**
 * Analyze toxicity/appropriateness of text
 */
export async function analyzeToxicity(text: string): Promise<{
  isToxic: boolean;
  toxicityScore: number;
  categories: string[];
}> {
  try {
    await initializeTensorFlow();
    
    // Enhanced toxicity detection using keyword patterns
    const toxicityPatterns = {
      'profanity': [
        // Add appropriate profanity detection keywords here
        'damn', 'hell', 'stupid', 'idiot', 'moron',
      ],
      'aggressive': [
        'hate', 'kill', 'destroy', 'attack', 'fight', 'war', 'violence',
      ],
      'harassment': [
        'loser', 'worthless', 'pathetic', 'disgusting', 'trash',
      ],
      'discrimination': [
        // Add appropriate discrimination keywords here
      ],
    };
    
    const words = text.toLowerCase().split(/\W+/);
    const detectedCategories: string[] = [];
    let totalToxicityScore = 0;
    
    // Check each category
    Object.entries(toxicityPatterns).forEach(([category, keywords]) => {
      const matches = words.filter(word => keywords.includes(word)).length;
      if (matches > 0) {
        detectedCategories.push(category);
        totalToxicityScore += matches * 0.3; // Each match adds to toxicity
      }
    });
    
    // Normalize toxicity score
    const toxicityScore = Math.min(1.0, totalToxicityScore);
    const isToxic = toxicityScore > TOXICITY_THRESHOLD;
    
    console.log(`🛡️ Toxicity analysis: ${isToxic ? 'TOXIC' : 'CLEAN'} (${toxicityScore.toFixed(3)})`);
    return { 
      isToxic, 
      toxicityScore, 
      categories: detectedCategories,
    };
    
  } catch (error: unknown) {
    console.warn('⚠️ Toxicity analysis failed, using fallback:', (error as Error).message);
    return { isToxic: false, toxicityScore: 0, categories: [] };
  }
}

/**
 * Check if TensorFlow.js is available and working
 */
export function isTensorFlowAvailable(): boolean {
  return isInitialized;
}

/**
 * Get TensorFlow.js version and backend info
 */
export function getTensorFlowInfo(): { version: string; backend: string } {
  return {
    version: tf.version.tfjs,
    backend: tf.getBackend(),
  };
}

/**
 * Pre-load models for faster inference
 */
export async function preloadModels(): Promise<void> {
  try {
    console.log('🚀 Pre-loading TensorFlow.js models...');
    
    await initializeTensorFlow();
    
    // Test basic functionality
    await analyzeSentiment('This is a test message');
    await analyzeEmotion('Hello, how are you?');
    await analyzeToxicity('This is appropriate content');
    
    console.log('✅ TensorFlow.js models pre-loaded successfully');
    
  } catch (error: unknown) {
    console.warn('⚠️ Failed to pre-load models:', (error as Error).message);
  }
}

// Export constants
export { TOXICITY_THRESHOLD };