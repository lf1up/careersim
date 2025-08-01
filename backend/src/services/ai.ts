import OpenAI from 'openai';
import { config } from '@/config/env';
import { AppDataSource } from '@/config/database';
import { SystemConfiguration } from '@/entities/SystemConfiguration';
import { Persona } from '@/entities/Persona';
import { Simulation } from '@/entities/Simulation';
import { SessionMessage, MessageType } from '@/entities/SessionMessage';

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
  private lastConfigUpdate: number = 0;
  
  // Static instance for cache management
  private static instance: AIService | null = null;
  
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
          isActive: true 
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
          isActive: true 
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
   * Generate AI persona response based on conversation context
   */
  async generatePersonaResponse(
    context: ConversationContext,
    userMessage: string
  ): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      const [aiConfig, systemPrompts] = await Promise.all([
        this.getAIConfig(),
        this.getSystemPrompts()
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

      // Analyze the response for emotional tone and sentiment
      const emotionalTone = this.analyzeEmotionalTone(response, context.persona);
      const sentiment = this.analyzeSentiment(response);

      return {
        message: response,
        emotionalTone,
        confidence: 0.85, // This could be enhanced with additional analysis
        processingTime,
        metadata: {
          tokenCount: completion.usage?.total_tokens || 0,
          model: completion.model,
          sentiment,
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
   * Analyze emotional tone of the response
   */
  private analyzeEmotionalTone(response: string, persona: Persona): string {
    // Simple keyword-based analysis (could be enhanced with ML)
    const toneIndicators = {
      friendly: ['glad', 'happy', 'pleased', 'wonderful', 'great', 'excellent'],
      neutral: ['okay', 'fine', 'understand', 'see', 'right'],
      skeptical: ['but', 'however', 'though', 'doubt', 'unsure', 'hmm'],
      frustrated: ['unfortunately', 'problem', 'difficult', 'challenging', 'no'],
      encouraging: ['good', 'right', 'exactly', 'perfect', 'yes', 'absolutely'],
    };

    const lowercaseResponse = response.toLowerCase();
    const toneScores: Record<string, number> = {};

    for (const [tone, indicators] of Object.entries(toneIndicators)) {
      toneScores[tone] = indicators.filter(indicator => 
        lowercaseResponse.includes(indicator)
      ).length;
    }

    // Return the tone with the highest score, or default based on persona
    const toneKeys = Object.keys(toneScores);
    if (toneKeys.length === 0) return 'neutral';
    
    const dominantTone = toneKeys.reduce((a, b) => 
      (toneScores[a] || 0) > (toneScores[b] || 0) ? a : b
    );

    return (toneScores[dominantTone] || 0) > 0 ? dominantTone : 'neutral';
  }

  /**
   * Analyze sentiment of the response
   */
  private analyzeSentiment(response: string): 'positive' | 'neutral' | 'negative' {
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
    userMessages: SessionMessage[]
  ): Promise<{
    overallFeedback: string;
    strengths: string[];
    improvementAreas: string[];
    specificSuggestions: string[];
  }> {
    try {
      const [aiConfig, systemPrompts] = await Promise.all([
        this.getAIConfig(),
        this.getSystemPrompts()
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
        allText.toLowerCase().includes(filler)
      ),
      collaborativeLanguage: collaborativeWords.filter(word => 
        allText.toLowerCase().includes(word)
      ).length,
      directiveLanguage: directiveWords.filter(word => 
        allText.toLowerCase().includes(word)
      ).length,
    };
  }
} 