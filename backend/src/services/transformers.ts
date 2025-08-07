/**
 * Transformers Microservice Client
 * Provides sentiment analysis and emotion detection using the local transformer models microservice
 */

import { config } from '@/config/env';

export interface SentimentResult {
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
}

export interface EmotionResult {
  emotion: string;
  confidence: number;
}

export interface ToxicityResult {
  isToxic: boolean;
  toxicityScore: number;
  categories: string[];
}

export interface TransformersHealthStatus {
  status: string;
  models_loaded: string[];
  message: string;
  cache_info?: Record<string, any>;
}

// API response types
interface ClassificationResult {
  label: string;
  confidence: number;
  processing_time_ms: number;
}

interface DetailedClassificationResult {
  predictions: Array<{ label: string; confidence: number }>;
  top_prediction: ClassificationResult;
  processing_time_ms: number;
}

export interface ZeroShotResult {
  label: string;
  confidence: number;
  allPredictions: Array<{ label: string; confidence: number }>;
}

export class TransformersService {
  private baseUrl: string;
  private apiKey: string;
  private headers: Record<string, string>;

  constructor() {
    this.baseUrl = config.ai.transformers.apiUrl;
    this.apiKey = config.ai.transformers.apiKey;
    this.headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Check if the transformers microservice is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      
      if (!response.ok) {
        console.warn(`Transformers service health check failed: ${response.status} ${response.statusText}`);
        return false;
      }

      const health = await response.json() as TransformersHealthStatus;
      const isHealthy = health.status === 'healthy' || health.status === 'partial';
      
      if (!isHealthy) {
        console.warn(`Transformers service not healthy: ${health.message}`);
      }
      
      return isHealthy;
    } catch (error) {
      console.warn('Transformers service is not available:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Get service health information
   */
  async getHealthInfo(): Promise<TransformersHealthStatus | null> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }

      return await response.json() as TransformersHealthStatus;
    } catch (error) {
      console.error('Failed to get transformers service health:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  /**
   * Analyze sentiment using the microservice
   */
  async analyzeSentiment(text: string): Promise<SentimentResult> {
    try {
      const response = await fetch(`${this.baseUrl}/sentiment`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`Sentiment analysis failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as DetailedClassificationResult;
      
      // Extract sentiment and confidence from the microservice response
      const prediction = result.top_prediction;
      let sentiment: 'positive' | 'neutral' | 'negative';
      
      // Map microservice labels to our expected format
      switch (prediction.label.toLowerCase()) {
      case 'positive':
        sentiment = 'positive';
        break;
      case 'negative':
        sentiment = 'negative';
        break;
      case 'neutral':
      default:
        sentiment = 'neutral';
        break;
      }

      console.log(`🤖 Sentiment analysis: ${sentiment} (${prediction.confidence.toFixed(3)})`);
      
      return {
        sentiment,
        confidence: prediction.confidence,
      };

    } catch (error) {
      console.warn('🔄 Sentiment analysis failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
      return this.analyzeSentimentFallback(text);
    }
  }

  /**
   * Analyze emotion using the microservice
   */
  async analyzeEmotion(text: string): Promise<EmotionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/emotion`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`Emotion analysis failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as DetailedClassificationResult;
      
      // Extract emotion and confidence from the microservice response
      const prediction = result.top_prediction;
      
      // Map microservice emotion labels to our expected format
      const emotionMapping: Record<string, string> = {
        'joy': 'friendly',
        'neutral': 'neutral',
        'sadness': 'concerned',
        'anger': 'frustrated',
        'fear': 'concerned',
        'surprise': 'encouraging',
        'disgust': 'frustrated',
      };
      
      const emotion = emotionMapping[prediction.label.toLowerCase()] || 'neutral';

      console.log(`🤖 Emotion analysis: ${prediction.label} -> ${emotion} (${prediction.confidence.toFixed(3)})`);
      
      return {
        emotion,
        confidence: prediction.confidence,
      };

    } catch (error) {
      console.warn('🔄 Emotion analysis failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
      return this.analyzeEmotionFallback(text);
    }
  }

  /**
   * Analyze toxicity using the microservice
   */
  async analyzeToxicity(text: string): Promise<ToxicityResult> {
    try {
      const response = await fetch(`${this.baseUrl}/toxicity`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`Toxicity analysis failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as ClassificationResult;
      
      // Extract toxicity information from the microservice response
      const isToxic = result.label.toLowerCase() === 'toxic';
      const toxicityScore = isToxic ? result.confidence : (1 - result.confidence);
      
      console.log(`🛡️ Toxicity analysis: ${result.label} (${result.confidence.toFixed(3)})`);
      
      return {
        isToxic,
        toxicityScore,
        categories: isToxic ? ['toxic'] : [],
      };

    } catch (error) {
      console.warn('🔄 Toxicity analysis failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
      return this.analyzeToxicityFallback(text);
    }
  }

  /**
   * Zero-shot classification using the microservice
   */
  async classifySequence(text: string, candidateLabels: string[]): Promise<ZeroShotResult> {
    try {
      const response = await fetch(`${this.baseUrl}/sequence`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ 
          text, 
          candidate_labels: candidateLabels, 
        }),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`Zero-shot classification failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as DetailedClassificationResult;
      
      console.log(`🎯 Zero-shot classification: ${result.top_prediction.label} (${result.top_prediction.confidence.toFixed(3)}) from [${candidateLabels.join(', ')}]`);
      
      return {
        label: result.top_prediction.label,
        confidence: result.top_prediction.confidence,
        allPredictions: result.predictions,
      };

    } catch (error) {
      console.warn('🔄 Zero-shot classification failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
      // Simple fallback: return the first label with low confidence
      return {
        label: candidateLabels[0],
        confidence: 0.3,
        allPredictions: candidateLabels.map(label => ({ label, confidence: 0.3 })),
      };
    }
  }

  /**
   * Fallback sentiment analysis using simple keyword matching
   */
  public analyzeSentimentFallback(text: string): SentimentResult {
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
    
    console.log(`📊 Sentiment analysis (fallback): ${sentiment} (${confidence.toFixed(3)})`);
    return { sentiment, confidence };
  }

  /**
   * Fallback emotion analysis using simple keyword matching
   */
  public analyzeEmotionFallback(text: string): EmotionResult {
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
    const emotionScores: Record<string, number> = {};
    
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
    
    console.log(`💭 Emotion analysis (fallback): ${finalEmotion} (${confidence.toFixed(3)})`);
    return { emotion: finalEmotion, confidence };
  }

  /**
   * Fallback toxicity analysis using simple keyword matching
   */
  public analyzeToxicityFallback(text: string): ToxicityResult {
    const toxicityPatterns = {
      'profanity': [
        'damn', 'hell', 'stupid', 'idiot', 'moron',
      ],
      'aggressive': [
        'hate', 'kill', 'destroy', 'attack', 'fight', 'war', 'violence',
      ],
      'harassment': [
        'loser', 'worthless', 'pathetic', 'disgusting', 'trash',
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
    const isToxic = toxicityScore > 0.7; // 70% threshold
    
    console.log(`🛡️ Toxicity analysis (fallback): ${isToxic ? 'TOXIC' : 'CLEAN'} (${toxicityScore.toFixed(3)})`);
    return { 
      isToxic, 
      toxicityScore, 
      categories: detectedCategories,
    };
  }
}

// Export a singleton instance
export const transformersService = new TransformersService();
