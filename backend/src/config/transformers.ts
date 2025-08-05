/**
 * Configure Transformers.js for Docker/server environments
 * This gracefully handles ONNX Runtime issues with fallback to keyword analysis
 */

// Global state
let transformersModule: any = null;
let transformersAvailable = false;
let fallbackMessage = '';

// Set up browser-like environment to avoid Node.js backend selection
if (typeof global !== 'undefined') {
  // Safely set global properties
  if (!(global as any).window) {
    (global as any).window = {};
  }
  
  if (!(global as any).document) {
    (global as any).document = {};
  }
  
  // Handle navigator property carefully (may be read-only in Node.js)
  try {
    if (!(global as any).navigator) {
      (global as any).navigator = { userAgent: 'Mozilla/5.0 (compatible; Node.js)' };
    }
  } catch (error) {
    // Navigator property is read-only, that's fine - skip it
    console.log('Note: navigator property is read-only, using existing value');
  }
  
  // Environment variables to force web backend
  process.env.TRANSFORMERS_BACKEND = 'web';
  process.env.ONNX_RUNTIME = 'web';
  process.env.HUGGINGFACE_TRANSFORMERS_BACKEND = 'web';
}

/**
 * Initialize Transformers.js with fallback handling
 */
async function initializeTransformers() {
  if (transformersModule) return transformersModule;
  
  try {
    console.log('🔄 Attempting to load Transformers.js with web backend...');
    
    // Dynamic import with error handling
    transformersModule = await import('@huggingface/transformers');
    
    // Configure for web/WASM environment
    transformersModule.env.backends.onnx.wasm.numThreads = 1;
    transformersModule.env.allowLocalModels = false;
    transformersModule.env.allowRemoteModels = true;
    transformersModule.env.cacheDir = './models';
    
    transformersAvailable = true;
    console.log('✅ Transformers.js loaded successfully with web backend');
    
    return transformersModule;
    
  } catch (error: any) {
    console.warn('⚠️  Transformers.js failed to load:', error.message);
    console.log('📝 Will fall back to simple keyword-based analysis');
    
    fallbackMessage = `Transformers.js unavailable: ${error.message}`;
    transformersAvailable = false;
    
    return null;
  }
}

/**
 * Get pipeline with fallback handling
 */
export async function createPipeline(task: string, model?: string, options?: any) {
  const transformers = await initializeTransformers();
  
  if (!transformers) {
    throw new Error(`Transformers.js not available: ${fallbackMessage}`);
  }
  
  return transformers.pipeline(task, model, options);
}

/**
 * Get environment configuration
 */
export async function getEnv() {
  const transformers = await initializeTransformers();
  return transformers?.env || {};
}

// Export utilities
export { transformersAvailable, fallbackMessage, initializeTransformers };