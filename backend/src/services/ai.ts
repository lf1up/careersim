import OpenAI from 'openai';
import { config } from '@/config/env';
import { AppDataSource } from '@/config/database';
import { SystemConfiguration } from '@/entities/SystemConfiguration';
import { Persona } from '@/entities/Persona';
import { Simulation } from '@/entities/Simulation';
import { SessionMessage, MessageType } from '@/entities/SessionMessage';
import { createPipeline, transformersAvailable, fallbackMessage } from '@/config/transformers';

export interface AIResponse {
  message: string;
  emotionalTone: string;
  confidence: number;
  processingTime: number;
  metadata: {
    tokenCount: number;
    model: string;
    sentiment: 'positive' | 'neutral' | 'negative';
  };
}

export interface ConversationContext {
  persona: Persona;
  simulation: Simulation;
  conversationHistory: SessionMessage[];
  userGoals?: string;
  sessionDuration: number;
}

export class AIService {
  private openai: OpenAI;
  private configCache: Map<string, any> = new Map();
  private configCacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private lastConfigUpdate = 0;
  
  // Static instance for cache management
  private static instance: AIService | null = null;
  
  // NLP Pipeline caches
  private static sentimentPipeline: any = null;
  private static emotionPipeline: any = null;
  
  constructor() {
    this.openai = new OpenAI({
      baseURL: config.ai.openai.baseUrl,
      apiKey: config.ai.openai.apiKey,
    });
    
    // Store instance for static access
    AIService.instance = this;
  }

  /**
   * Static method to clear cache from outside the service
   */
  public static clearGlobalConfigCache() {
    if (AIService.instance) {
      AIService.instance.clearConfigCache();
    }
  }

  /**
   * Pre-load NLP models for faster first-time analysis
   * Call this during application startup for better performance
   */
  public static async preloadNLPModels(): Promise<void> {
    try {
      console.log('Pre-loading NLP models...');
      
      const instance = new AIService();
      await Promise.all([
        instance.getSentimentPipeline(),
        instance.getEmotionPipeline(),
      ]);
      console.log('NLP models pre-loaded successfully');
    } catch (error) {
      console.warn('Failed to pre-load NLP models:', error);
    }
  }

  /**
   * Get AI configuration from database with caching
   */
  private async getAIConfig() {
    const now = Date.now();
    if (this.configCache.has('ai_settings') && (now - this.lastConfigUpdate) < this.configCacheExpiry) {
      return this.configCache.get('ai_settings');
    }

    try {
      const configRepository = AppDataSource.getRepository(SystemConfiguration);
      const aiConfig = await configRepository.findOne({
        where: { 
          configKey: SystemConfiguration.CONFIG_KEYS.AI_MODEL_SETTINGS,
          isActive: true, 
        },
      });

      const settings = aiConfig?.aiModelSettings || SystemConfiguration.getDefaultAISettings();
      this.configCache.set('ai_settings', settings);
      this.lastConfigUpdate = now;
      return settings;
    } catch (error) {
      console.error('Error loading AI config from database, using defaults:', error);
      return SystemConfiguration.getDefaultAISettings();
    }
  }

  /**
   * Get system prompts from database with caching
   */
  private async getSystemPrompts() {
    const now = Date.now();
    if (this.configCache.has('system_prompts') && (now - this.lastConfigUpdate) < this.configCacheExpiry) {
      return this.configCache.get('system_prompts');
    }

    try {
      const configRepository = AppDataSource.getRepository(SystemConfiguration);
      const promptsConfig = await configRepository.findOne({
        where: { 
          configKey: SystemConfiguration.CONFIG_KEYS.SYSTEM_PROMPTS,
          isActive: true, 
        },
      });

      const prompts = promptsConfig?.systemPrompts || SystemConfiguration.getDefaultSystemPrompts();
      this.configCache.set('system_prompts', prompts);
      this.lastConfigUpdate = now;
      return prompts;
    } catch (error) {
      console.error('Error loading system prompts from database, using defaults:', error);
      return SystemConfiguration.getDefaultSystemPrompts();
    }
  }

  /**
   * Clear configuration cache (useful when settings are updated)
   */
  public clearConfigCache() {
    this.configCache.clear();
    this.lastConfigUpdate = 0;
  }

  /**
   * Initialize sentiment analysis pipeline with caching
   */
  private async getSentimentPipeline(): Promise<any> {
    if (!AIService.sentimentPipeline) {
      try {
        console.log('Loading sentiment analysis model...');
        AIService.sentimentPipeline = await createPipeline(
          'sentiment-analysis',
          'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
        );
        console.log('Sentiment analysis model loaded successfully');
      } catch (error) {
        console.error('Failed to load sentiment analysis model:', error);
        throw new Error(`Failed to initialize sentiment analysis: ${error.message}`);
      }
    }
    return AIService.sentimentPipeline;
  }

  /**
   * Initialize emotion classification pipeline with caching
   */
  private async getEmotionPipeline(): Promise<any> {
    if (!AIService.emotionPipeline) {
      try {
        console.log('Loading emotion detection model...');
        AIService.emotionPipeline = await createPipeline(
          'text-classification',
          'j-hartmann/emotion-english-distilroberta-base',
        );
        console.log('Emotion detection model loaded successfully');
      } catch (error) {
        console.error('Failed to load emotion detection model:', error);
        throw new Error(`Failed to initialize emotion detection: ${error.message}`);
      }
    }
    return AIService.emotionPipeline;
  }

  /**
   * Generate AI persona response based on conversation context
   */
  async generatePersonaResponse(
    context: ConversationContext,
    userMessage: string,
  ): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      const [aiConfig, systemPrompts] = await Promise.all([
        this.getAIConfig(),
        this.getSystemPrompts(),
      ]);

      const systemPrompt = this.buildSystemPrompt(context, systemPrompts.baseSystemPrompt);
      const conversationMessages = this.buildConversationHistory(context.conversationHistory);

      const completion = await this.openai.chat.completions.create({
        model: aiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationMessages,
          { role: 'user', content: userMessage },
        ],
        max_tokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature,
        frequency_penalty: aiConfig.frequencyPenalty,
        presence_penalty: aiConfig.presencePenalty,
        top_p: aiConfig.topP,
      });

      const response = completion.choices[0]?.message?.content || '';
      const processingTime = Date.now() - startTime;

      // Analyze the response for emotional tone and sentiment using professional NLP
      const [emotionAnalysis, sentimentAnalysis] = await Promise.all([
        this.analyzeEmotionalToneWithConfidence(response, context.persona),
        this.analyzeSentimentWithConfidence(response),
      ]);

      // Calculate overall confidence based on NLP model confidence scores
      const confidence = await this.calculateOverallConfidence(emotionAnalysis, sentimentAnalysis, response, context);

      return {
        message: response,
        emotionalTone: emotionAnalysis.tone,
        confidence,
        processingTime,
        metadata: {
          tokenCount: completion.usage?.total_tokens || 0,
          model: completion.model,
          sentiment: sentimentAnalysis.sentiment,
        },
      };
    } catch (error) {
      console.error('Error generating AI response:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  /**
   * Build system prompt for the AI persona using configurable template
   */
  private buildSystemPrompt(context: ConversationContext, promptTemplate: string): string {
    const { persona, simulation } = context;
    
    // Replace template variables with actual values
    return promptTemplate
      .replace(/\{persona\.name\}/g, persona.name)
      .replace(/\{persona\.role\}/g, persona.role)
      .replace(/\{persona\.personality\}/g, persona.personality)
      .replace(/\{persona\.primaryGoal\}/g, persona.primaryGoal)
      .replace(/\{persona\.hiddenMotivation\}/g, persona.hiddenMotivation)
      .replace(/\{persona\.difficultyLevel\}/g, persona.difficultyLevel.toString())
      .replace(/\{simulation\.title\}/g, simulation.title)
      .replace(/\{simulation\.scenario\}/g, simulation.scenario)
      .replace(/\{simulation\.objectives\}/g, Array.isArray(simulation.objectives) ? simulation.objectives.join(', ') : simulation.objectives)
      .replace(/\{persona\.conversationStyle\}/g, persona.conversationStyle ? JSON.stringify(persona.conversationStyle, null, 2) : 'Natural, professional conversation');
  }

  /**
   * Build conversation history for context
   */
  private buildConversationHistory(messages: SessionMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    return messages
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map(message => ({
        role: message.type === MessageType.USER ? 'user' : 'assistant',
        content: message.content,
      }));
  }

  /**
   * Analyze emotional tone with confidence score
   */
  private async analyzeEmotionalToneWithConfidence(response: string, persona: Persona): Promise<{ tone: string; confidence: number }> {
    try {
      // Check if Transformers.js is available
      if (!transformersAvailable) {
        console.log(`🔄 Emotion analysis fallback (${fallbackMessage}): using simple heuristics`);
        return { tone: this.analyzeEmotionalToneFallback(response, persona), confidence: 0.5 };
      }

      const emotionPipeline = await this.getEmotionPipeline();
      const result = await emotionPipeline(response) as Array<{ label: string; score: number }>;
      
      // The model returns emotions like: joy, sadness, anger, fear, surprise, disgust, neutral
      // Map them to more user-friendly tone descriptions
      const emotionToTone = {
        'joy': 'friendly',
        'happiness': 'friendly',
        'optimism': 'encouraging',
        'approval': 'encouraging',
        'excitement': 'encouraging',
        'love': 'friendly',
        'admiration': 'encouraging',
        'amusement': 'friendly',
        'gratitude': 'friendly',
        'desire': 'encouraging',
        'caring': 'friendly',
        'pride': 'encouraging',
        'relief': 'friendly',
        
        'sadness': 'sympathetic',
        'disappointment': 'understanding',
        'grief': 'sympathetic',
        'remorse': 'understanding',
        
        'anger': 'frustrated',
        'annoyance': 'frustrated',
        'disapproval': 'skeptical',
        'disgust': 'frustrated',
        
        'fear': 'concerned',
        'nervousness': 'concerned',
        'confusion': 'uncertain',
        'embarrassment': 'understanding',
        
        'surprise': 'engaged',
        'curiosity': 'engaged',
        'realization': 'understanding',
        
        'neutral': 'neutral',
      } as const;

      // Get the highest scoring emotion
      const topEmotion = result.reduce((prev, current) => 
        current.score > prev.score ? current : prev,
      );

      // Map to tone, defaulting to neutral if not found
      const tone = emotionToTone[topEmotion.label.toLowerCase() as keyof typeof emotionToTone] || 'neutral';
      
      console.log(`Emotion analysis: ${topEmotion.label} (${topEmotion.score.toFixed(3)}) -> ${tone}`);
      return { tone, confidence: topEmotion.score };
      
    } catch (error) {
      console.warn('Emotion analysis failed, using fallback:', error.message);
      return { tone: this.analyzeEmotionalToneFallback(response, persona), confidence: 0.3 };
    }
  }

  /**
   * Analyze emotional tone of the response using professional NLP with fallback (legacy method)
   */
  private async analyzeEmotionalTone(response: string, persona: Persona): Promise<string> {
    const result = await this.analyzeEmotionalToneWithConfidence(response, persona);
    return result.tone;
  }

  /**
   * Analyze sentiment with confidence score
   */
  private async analyzeSentimentWithConfidence(response: string): Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; confidence: number }> {
    try {
      // Check if Transformers.js is available
      if (!transformersAvailable) {
        console.log(`🔄 Sentiment analysis fallback (${fallbackMessage}): using simple heuristics`);
        return { sentiment: this.analyzeSentimentFallback(response), confidence: 0.5 };
      }

      const sentimentPipeline = await this.getSentimentPipeline();
      const result = await sentimentPipeline(response) as Array<{ label: string; score: number }>;
      
      // The BERT model returns 'POSITIVE' or 'NEGATIVE' with confidence scores
      const topSentiment = result.reduce((prev, current) => 
        current.score > prev.score ? current : prev,
      );
      
      const label = topSentiment.label.toLowerCase();
      const score = topSentiment.score;
      
      // Apply threshold for neutral classification
      // If confidence is low (< 0.75), classify as neutral
      if (score < 0.75) {
        console.log(`Sentiment analysis: ${label} (${score.toFixed(3)}) -> neutral (low confidence)`);
        return { sentiment: 'neutral', confidence: score };
      }
      
      const sentiment = label === 'positive' ? 'positive' : 'negative';
      console.log(`Sentiment analysis: ${label} (${score.toFixed(3)}) -> ${sentiment}`);
      return { sentiment, confidence: score };
      
    } catch (error) {
      console.warn('Sentiment analysis failed, using fallback:', error.message);
      return { sentiment: this.analyzeSentimentFallback(response), confidence: 0.3 };
    }
  }

  /**
   * Analyze sentiment of the response using professional NLP with fallback (legacy method)
   */
  private async analyzeSentiment(response: string): Promise<'positive' | 'neutral' | 'negative'> {
    const result = await this.analyzeSentimentWithConfidence(response);
    return result.sentiment;
  }

  /**
   * Calculate overall confidence using multiple approaches including transformer-based assessment
   */
  private async calculateOverallConfidence(
    emotionAnalysis: { tone: string; confidence: number },
    sentimentAnalysis: { sentiment: 'positive' | 'neutral' | 'negative'; confidence: number },
    response: string,
    context: ConversationContext,
  ): Promise<number> {
    try {
      // Get transformer-based confidence assessment if available
      const transformerConfidence = await this.getTransformerConfidenceScore(response, context);
      
      // Weight the confidence scores
      const emotionWeight = 0.3;
      const sentimentWeight = 0.2;
      const transformerWeight = 0.5; // Give more weight to transformer-based assessment
      
      // Calculate weighted average
      const baseConfidence = (emotionAnalysis.confidence * emotionWeight) + 
                            (sentimentAnalysis.confidence * sentimentWeight) + 
                            (transformerConfidence * transformerWeight);
      
      // Apply contextual adjustments
      const adjustedConfidence = this.applyContextualAdjustments(
        baseConfidence, 
        emotionAnalysis, 
        sentimentAnalysis, 
        response, 
        context,
      );
      
      // Ensure confidence is between 0 and 1
      return Math.max(0, Math.min(1, adjustedConfidence));
      
    } catch (error) {
      console.warn('Advanced confidence calculation failed, using fallback:', error.message);
      return this.calculateBasicConfidence(emotionAnalysis, sentimentAnalysis);
    }
  }

  /**
   * Get confidence score using transformer-based text quality assessment
   */
  private async getTransformerConfidenceScore(response: string, context: ConversationContext): Promise<number> {
    try {
      // Check if Transformers.js is available
      if (!transformersAvailable) {
        console.log(`🔄 Transformer confidence assessment fallback (${fallbackMessage}): using heuristics`);
        return this.getHeuristicConfidenceScore(response, context);
      }

      // Use a multi-faceted approach for confidence assessment
      const assessments = await Promise.all([
        this.assessResponseCoherence(response),
        this.assessResponseRelevance(response, context),
        this.assessResponseCompleteness(response, context),
      ]);

      // Combine the assessments with weights
      const coherenceWeight = 0.4;
      const relevanceWeight = 0.4;
      const completenessWeight = 0.2;

      const confidence = (assessments[0] * coherenceWeight) + 
                        (assessments[1] * relevanceWeight) + 
                        (assessments[2] * completenessWeight);

      console.log(`Transformer confidence: coherence=${assessments[0].toFixed(3)}, relevance=${assessments[1].toFixed(3)}, completeness=${assessments[2].toFixed(3)} -> ${confidence.toFixed(3)}`);
      return confidence;

    } catch (error) {
      console.warn('Transformer confidence assessment failed:', error.message);
      return this.getHeuristicConfidenceScore(response, context);
    }
  }

  /**
   * Assess response coherence using text classification
   */
  private async assessResponseCoherence(response: string): Promise<number> {
    try {
      // Try advanced transformer-based coherence assessment first
      if (transformersAvailable) {
        const advancedScore = await this.getAdvancedCoherenceScore(response);
        if (advancedScore !== null) {
          return advancedScore;
        }
      }

      // Fallback to linguistic feature analysis
      const qualityIndicators = {
        hasProperSentenceStructure: /^[A-Z].*[.!?]$/.test(response.trim()),
        hasReasonableLength: response.length >= 10 && response.length <= 500,
        hasNoRepeatedPhrases: !/((.+)\1{2,})/.test(response),
        hasVariedVocabulary: new Set(response.toLowerCase().split(/\W+/)).size > response.split(/\W+/).length * 0.3,
        hasProperPunctuation: /[.!?]/.test(response),
        hasLogicalFlow: this.assessLogicalFlow(response),
        hasAppropriateComplexity: this.assessComplexity(response),
      };

      const scoreCount = Object.values(qualityIndicators).filter(Boolean).length;
      return scoreCount / Object.keys(qualityIndicators).length;

    } catch (error) {
      console.warn('Coherence assessment failed:', error.message);
      return 0.5;
    }
  }

  /**
   * Advanced coherence scoring using transformer models (if specific models become available)
   */
  private async getAdvancedCoherenceScore(_response: string): Promise<number | null> {
    try {
      // In the future, this could use models like:
      // - Text quality assessment models
      // - Coherence classification models  
      // - Grammar/fluency scoring models
      
      // For now, we return null to indicate this is not yet implemented
      // but the infrastructure is ready for when such models become available
      console.log('🔬 Advanced transformer coherence assessment: waiting for specialized models');
      return null;
      
      /* Future implementation example:
      const qualityPipeline = await createPipeline(
        'text-classification',
        'coherence-assessment-model' // Hypothetical model
      );
      
      const result = await qualityPipeline(response);
      // Convert classification result to confidence score
      return this.convertClassificationToConfidence(result);
      */

    } catch (error) {
      console.warn('Advanced coherence assessment failed:', error.message);
      return null;
    }
  }

  /**
   * Assess logical flow of the response
   */
  private assessLogicalFlow(response: string): boolean {
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length <= 1) return true; // Single sentence is considered coherent
    
    // Check for transition words/phrases that indicate logical flow
    const transitionWords = ['however', 'therefore', 'moreover', 'furthermore', 'additionally', 
      'consequently', 'meanwhile', 'similarly', 'in contrast', 'for example'];
    
    const hasTransitions = sentences.some(sentence => 
      transitionWords.some(word => sentence.toLowerCase().includes(word)),
    );
    
    // Check for pronoun consistency (basic check)
    const pronounPattern = /\b(it|they|this|that|these|those)\b/gi;
    const hasPronouns = sentences.some(sentence => pronounPattern.test(sentence));
    
    return hasTransitions || hasPronouns || sentences.length <= 3;
  }

  /**
   * Assess complexity appropriateness
   */
  private assessComplexity(response: string): boolean {
    const words = response.split(/\s+/);
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    const complexWords = words.filter(word => word.length > 6).length;
    const complexityRatio = complexWords / words.length;
    
    // Appropriate complexity: not too simple, not overly complex
    return avgWordLength >= 3.5 && avgWordLength <= 8 && complexityRatio >= 0.1 && complexityRatio <= 0.4;
  }

  /**
   * Assess response relevance to the conversation context
   */
  private async assessResponseRelevance(response: string, context: ConversationContext): Promise<number> {
    try {
      // Calculate relevance based on context matching
      const responseWords = new Set(response.toLowerCase().split(/\W+/).filter(word => word.length > 2));
      const contextWords = new Set([
        ...context.persona.role.toLowerCase().split(/\W+/),
        ...context.persona.personality.toLowerCase().split(/\W+/),
        ...context.simulation.title.toLowerCase().split(/\W+/),
        ...context.simulation.scenario.toLowerCase().split(/\W+/),
      ].filter(word => word.length > 2));

      // Calculate word overlap
      const intersection = new Set([...responseWords].filter(word => contextWords.has(word)));
      const overlap = intersection.size / Math.min(responseWords.size, contextWords.size);

      // Also check if response addresses recent conversation
      let conversationRelevance = 0.5;
      if (context.conversationHistory.length > 0) {
        const recentMessages = context.conversationHistory.slice(-3);
        const recentWords = new Set(recentMessages
          .map(msg => msg.content.toLowerCase())
          .join(' ')
          .split(/\W+/)
          .filter(word => word.length > 2),
        );
        
        const recentIntersection = new Set([...responseWords].filter(word => recentWords.has(word)));
        conversationRelevance = recentIntersection.size / Math.min(responseWords.size, recentWords.size || 1);
      }

      return Math.min(1, (overlap + conversationRelevance) / 2);

    } catch (error) {
      console.warn('Relevance assessment failed:', error.message);
      return 0.5;
    }
  }

  /**
   * Assess response completeness
   */
  private async assessResponseCompleteness(response: string, _context: ConversationContext): Promise<number> {
    try {
      // Check if response seems complete and appropriate for the context
      const completenessIndicators = {
        hasMinimumLength: response.length >= 20,
        hasEndingPunctuation: /[.!?]$/.test(response.trim()),
        notTooShort: response.split(/\s+/).length >= 5,
        notTooLong: response.split(/\s+/).length <= 100,
        hasSubstantiveContent: !/^(yes|no|ok|sure|maybe)\.?$/i.test(response.trim()),
      };

      const scoreCount = Object.values(completenessIndicators).filter(Boolean).length;
      return scoreCount / Object.keys(completenessIndicators).length;

    } catch (error) {
      console.warn('Completeness assessment failed:', error.message);
      return 0.5;
    }
  }

  /**
   * Apply contextual adjustments to confidence score
   */
  private applyContextualAdjustments(
    baseConfidence: number,
    emotionAnalysis: { tone: string; confidence: number },
    sentimentAnalysis: { sentiment: 'positive' | 'neutral' | 'negative'; confidence: number },
    response: string,
    context: ConversationContext,
  ): number {
    let adjustedConfidence = baseConfidence;
    
    // If both models agree on neutral/positive sentiment, increase confidence slightly
    if ((emotionAnalysis.tone === 'neutral' && sentimentAnalysis.sentiment === 'neutral') ||
        (['friendly', 'encouraging'].includes(emotionAnalysis.tone) && sentimentAnalysis.sentiment === 'positive')) {
      adjustedConfidence = Math.min(0.95, adjustedConfidence + 0.05);
    }
    
    // If models seem to disagree, reduce confidence
    if ((sentimentAnalysis.sentiment === 'negative' && ['friendly', 'encouraging'].includes(emotionAnalysis.tone)) ||
        (sentimentAnalysis.sentiment === 'positive' && ['frustrated', 'concerned'].includes(emotionAnalysis.tone))) {
      adjustedConfidence = Math.max(0.3, adjustedConfidence - 0.1);
    }

    // Adjust based on response characteristics
    if (response.length < 10) {
      adjustedConfidence *= 0.8; // Very short responses are less confident
    }
    
    if (context.conversationHistory.length === 0) {
      adjustedConfidence *= 0.9; // First response in conversation might be less confident
    }

    return adjustedConfidence;
  }

  /**
   * Fallback confidence calculation using basic heuristics
   */
  private calculateBasicConfidence(
    emotionAnalysis: { tone: string; confidence: number },
    sentimentAnalysis: { sentiment: 'positive' | 'neutral' | 'negative'; confidence: number },
  ): number {
    const emotionWeight = 0.6;
    const sentimentWeight = 0.4;
    
    const weightedConfidence = (emotionAnalysis.confidence * emotionWeight) + (sentimentAnalysis.confidence * sentimentWeight);
    return Math.max(0, Math.min(1, weightedConfidence));
  }

  /**
   * Heuristic-based confidence score when transformers are not available
   */
  private getHeuristicConfidenceScore(response: string, context: ConversationContext): number {
    const indicators = {
      lengthScore: Math.min(1, Math.max(0, (response.length - 10) / 200)),
      structureScore: /^[A-Z].*[.!?]$/.test(response.trim()) ? 1 : 0.5,
      vocabularyScore: new Set(response.toLowerCase().split(/\W+/)).size / Math.max(1, response.split(/\W+/).length),
      contextScore: this.calculateContextRelevanceScore(response, context),
    };

    return Object.values(indicators).reduce((sum, score) => sum + score, 0) / Object.keys(indicators).length;
  }

  /**
   * Calculate how relevant the response is to the context
   */
  private calculateContextRelevanceScore(response: string, context: ConversationContext): number {
    const responseWords = response.toLowerCase().split(/\W+/).filter(word => word.length > 2);
    const contextText = [
      context.persona.role,
      context.persona.personality,
      context.simulation.title,
    ].join(' ').toLowerCase();
    
    const contextWords = contextText.split(/\W+/).filter(word => word.length > 2);
    const intersection = responseWords.filter(word => contextWords.includes(word));
    
    return intersection.length / Math.max(1, responseWords.length);
  }

  /**
   * Fallback emotion analysis using simple keyword matching
   */
  private analyzeEmotionalToneFallback(response: string, _persona: Persona): string {
    const toneIndicators = {
      friendly: ['glad', 'happy', 'pleased', 'wonderful', 'great', 'excellent', 'love', 'enjoy'],
      neutral: ['okay', 'fine', 'understand', 'see', 'right'],
      skeptical: ['but', 'however', 'though', 'doubt', 'unsure', 'hmm'],
      frustrated: ['unfortunately', 'problem', 'difficult', 'challenging', 'no', 'wrong'],
      encouraging: ['good', 'right', 'exactly', 'perfect', 'yes', 'absolutely'],
    };

    const lowercaseResponse = response.toLowerCase();
    const toneScores = new Map<string, number>();

    for (const [tone, indicators] of Object.entries(toneIndicators)) {
      const score = indicators.filter(indicator => 
        lowercaseResponse.includes(indicator),
      ).length;
      toneScores.set(tone, score);
    }

    const toneKeys = Array.from(toneScores.keys());
    if (toneKeys.length === 0) return 'neutral';
    
    const dominantTone = toneKeys.reduce((a, b) => 
      (toneScores.get(a) || 0) > (toneScores.get(b) || 0) ? a : b,
    );

    return (toneScores.get(dominantTone) || 0) > 0 ? dominantTone : 'neutral';
  }

  /**
   * Fallback sentiment analysis using simple keyword matching
   */
  private analyzeSentimentFallback(response: string): 'positive' | 'neutral' | 'negative' {
    const positiveWords = ['good', 'great', 'excellent', 'wonderful', 'perfect', 'yes', 'absolutely', 'right'];
    const negativeWords = ['no', 'bad', 'terrible', 'wrong', 'difficult', 'problem', 'unfortunately'];

    const lowercaseResponse = response.toLowerCase();
    const positiveCount = positiveWords.filter(word => lowercaseResponse.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowercaseResponse.includes(word)).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * Generate performance feedback based on conversation using configurable prompt
   */
  async generatePerformanceFeedback(
    context: ConversationContext,
    userMessages: SessionMessage[],
  ): Promise<{
    overallFeedback: string;
    strengths: string[];
    improvementAreas: string[];
    specificSuggestions: string[];
  }> {
    try {
      const [aiConfig, systemPrompts] = await Promise.all([
        this.getAIConfig(),
        this.getSystemPrompts(),
      ]);

      const userMessagesText = userMessages
        .filter(msg => msg.type === MessageType.USER)
        .map(msg => msg.content)
        .join('\n');

      // Use configurable prompt template
      const analysisPrompt = systemPrompts.performanceAnalysisPrompt
        .replace(/\{persona\.name\}/g, context.persona.name)
        .replace(/\{persona\.role\}/g, context.persona.role)
        .replace(/\{persona\.primaryGoal\}/g, context.persona.primaryGoal)
        .replace(/\{persona\.hiddenMotivation\}/g, context.persona.hiddenMotivation)
        .replace(/\{simulation\.title\}/g, context.simulation.title)
        .replace(/\{userMessages\}/g, userMessagesText);

      const completion = await this.openai.chat.completions.create({
        model: aiConfig.model,
        messages: [{ role: 'user', content: analysisPrompt }],
        max_tokens: Math.min(aiConfig.maxTokens, 1000), // Limit for feedback
        temperature: Math.min(aiConfig.temperature, 0.3), // Lower temperature for analysis
        top_p: Math.min(aiConfig.topP, 0.9), // Lower top_p for more focused analysis
      });

      const response = completion.choices[0]?.message?.content || '{}';
      return JSON.parse(response);
    } catch (error) {
      console.error('Error generating performance feedback:', error);
      return {
        overallFeedback: 'Unable to generate detailed feedback at this time.',
        strengths: ['Participated in the simulation'],
        improvementAreas: ['Continue practicing communication skills'],
        specificSuggestions: ['Try more simulations to improve'],
      };
    }
  }

  /**
   * Analyze communication patterns
   */
  analyzeCommunicationPatterns(userMessages: SessionMessage[]): {
    totalWords: number;
    averageWordsPerMessage: number;
    questionCount: number;
    statementCount: number;
    fillerWords: string[];
    collaborativeLanguage: number;
    directiveLanguage: number;
  } {
    const userTexts = userMessages
      .filter(msg => msg.type === MessageType.USER)
      .map(msg => msg.content);

    const allText = userTexts.join(' ');
    const words = allText.trim().split(/\s+/);
    const totalWords = words.length;

    const fillerWords = ['um', 'uh', 'like', 'you know', 'sort of', 'kind of'];
    const collaborativeWords = ['we', 'together', 'collaborate', 'partnership', 'team'];
    const directiveWords = ['must', 'should', 'need to', 'have to', 'require'];

    const questionCount = userTexts.filter(text => text.includes('?')).length;
    const statementCount = userTexts.length - questionCount;

    return {
      totalWords,
      averageWordsPerMessage: userTexts.length > 0 ? totalWords / userTexts.length : 0,
      questionCount,
      statementCount,
      fillerWords: fillerWords.filter(filler => 
        allText.toLowerCase().includes(filler),
      ),
      collaborativeLanguage: collaborativeWords.filter(word => 
        allText.toLowerCase().includes(word),
      ).length,
      directiveLanguage: directiveWords.filter(word => 
        allText.toLowerCase().includes(word),
      ).length,
    };
  }
} 