import OpenAI from 'openai';
import { config } from '@/config/env';
import { AppDataSource } from '@/config/database';
import { SystemConfiguration } from '@/entities/SystemConfiguration';
import { Persona } from '@/entities/Persona';
import { Simulation } from '@/entities/Simulation';
import { SimulationSession } from '@/entities/SimulationSession';
import { SessionMessage, MessageType } from '@/entities/SessionMessage';
import { transformersService } from '@/services/transformers';
import { RAGService } from '@/services/rag';

export interface AIResponse {
  message: string;
  emotionalTone: string;
  confidence: number;
  processingTime: number;
  metadata: {
    tokenCount: number;
    model: string;
    sentiment: 'positive' | 'neutral' | 'negative';
    // Extended metadata for reuse in evaluations
    emotionAnalysis?: {
      emotion: string;
      confidence: number;
    };
    sentimentAnalysis?: {
      sentiment: 'positive' | 'neutral' | 'negative';
      confidence: number;
    };
    // Additional analysis scores for comprehensive tracking
    qualityScores?: {
      overall?: number;
      coherence?: number;
      relevance?: number;
      completeness?: number;
      personaAlignment?: number;
    };
  };
}

export interface ConversationContext {
  persona: Persona;
  simulation: Simulation;
  conversationHistory: SessionMessage[];
  userGoals?: string;
  sessionDuration: number;
}

type ProactiveReason = 'start' | 'inactivity' | 'backchannel' | 'followup';

export class AIService {
  private openai: OpenAI;
  private configCache: Map<string, any> = new Map();
  private configCacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private lastConfigUpdate = 0;
  private ragContextCache: Map<string, string> = new Map();
  private ragTurnContextCache: Map<string, string> = new Map();
  
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
   * Resolve a specific AI profile by name with fallback to base settings
   */
  private resolveAIProfile(
    base: SystemConfiguration['aiModelSettings'],
    profile: 'generation' | 'evaluation',
  ) {
    // Avoid dynamic key access to satisfy security/detect-object-injection
    const overrides = profile === 'generation'
      ? (base?.profiles?.generation ?? {})
      : (base?.profiles?.evaluation ?? {});
    return {
      model: overrides.model || base?.model,
      maxTokens: Math.min(
        typeof overrides.maxTokens === 'number' ? overrides.maxTokens : (base?.maxTokens || 2000),
        4000,
      ),
      temperature: typeof overrides.temperature === 'number' ? overrides.temperature : (base?.temperature ?? 0.8),
      frequencyPenalty: typeof overrides.frequencyPenalty === 'number' ? overrides.frequencyPenalty : (base?.frequencyPenalty ?? 0.3),
      presencePenalty: typeof overrides.presencePenalty === 'number' ? overrides.presencePenalty : (base?.presencePenalty ?? 0.3),
      topP: typeof overrides.topP === 'number' ? overrides.topP : (base?.topP ?? 1.0),
    };
  }

  /**
   * Evaluate which conversation goals were reached using the LLM.
   * Returns a normalized structure that caller can merge into session progress.
   */
  public async evaluateGoalsWithLLM(params: {
    simulation: Simulation;
    session: SimulationSession;
    goals: NonNullable<Simulation['conversationGoals']>;
    lastUserMessage?: SessionMessage;
    lastAiMessage?: SessionMessage;
    recentMessages?: SessionMessage[]; // optional, if caller wants to pass a larger window
  }): Promise<{
    steps: Array<{
      stepNumber: number;
      status: 'achieved' | 'in_progress' | 'not_started';
      confidence: number; // 0..1
      evidence?: Array<{ role: 'user' | 'ai'; quote: string }>;
    }>;
  }> {
    const start = Date.now();
    const { simulation, goals, lastAiMessage, lastUserMessage, recentMessages } = params;

    const [aiSettings] = await Promise.all([
      this.getAIConfig(),
      // We re-use config cache; system prompts are not required for this task
    ]);

    const evalConfig = this.resolveAIProfile(aiSettings, 'evaluation');

    // Prepare compact recent conversation window (fallback to last two messages)
    const windowMessages: SessionMessage[] = Array.isArray(recentMessages) && recentMessages.length > 0
      ? recentMessages
      : [lastUserMessage, lastAiMessage].filter(Boolean) as SessionMessage[];

    const messagesForModel = windowMessages
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map((m) => ({ role: m.isFromUser ? 'user' : (m.isFromAI ? 'assistant' : 'system'), content: m.content }));

    // Build task prompt with strict JSON output instructions
    const systemInstruction = [
      'You are an expert evaluator for conversation-based simulations.',
      'Your task is to evaluate which conversation goals have been achieved based on the most recent exchange(s).',
      'Be conservative. Only mark a goal as achieved if there is clear evidence in the provided messages.',
      'If evidence is partial, use in_progress with appropriate confidence.',
      'Return ONLY valid JSON. Do not include any commentary or code fences.',
    ].join(' ');

    const goalsDescription = goals
      .slice()
      .sort((a, b) => a.goalNumber - b.goalNumber)
      .map((g) => ({
        stepNumber: g.goalNumber,
        isOptional: !!g.isOptional,
        title: g.title,
        description: g.description,
        keyBehaviors: g.keyBehaviors || [],
        successIndicators: g.successIndicators || [],
      }));

    const userInstruction = {
      task: 'Evaluate achieved goals from the recent conversation window.',
      simulation: {
        title: simulation.title,
        scenario: simulation.scenario,
      },
      goals: goalsDescription,
      recentConversation: messagesForModel,
      outputSchema: {
        steps: [
          {
            stepNumber: 'number',
            status: '\'achieved\' | \'in_progress\' | \'not_started\'',
            confidence: 'number (0..1)',
            evidence: [
              { role: '\'user\' | \'ai\'', quote: 'string (short quote demonstrating evidence)' },
            ],
          },
        ],
      },
      instructions: [
        'Only include steps that are achieved or in_progress. Omit not_started unless it was previously in progress and regressed (rare).',
        'Confidence should reflect certainty from the provided messages only.',
        'Prefer concise evidence quotes. Include at most 2 items per step.',
      ],
    };

    const completion = await this.openai.chat.completions.create({
      model: evalConfig.model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: JSON.stringify(userInstruction) },
      ],
      max_tokens: evalConfig.maxTokens,
      temperature: evalConfig.temperature,
      top_p: evalConfig.topP,
      frequency_penalty: evalConfig.frequencyPenalty,
      presence_penalty: evalConfig.presencePenalty,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
    const parsed = this.parseJsonLax(raw);
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];

    // Normalize step items and clamp values
    const normalized = steps
      .filter((s: any) => typeof s?.stepNumber === 'number')
      .map((s: any) => ({
        stepNumber: s.stepNumber,
        status: s.status === 'achieved' || s.status === 'in_progress' ? s.status : 'not_started',
        confidence: Math.max(0, Math.min(1, typeof s.confidence === 'number' ? s.confidence : 0)),
        evidence: Array.isArray(s.evidence)
          ? s.evidence
            .filter((e: any) => e && (e.role === 'user' || e.role === 'ai') && typeof e.quote === 'string')
            .slice(0, 2)
          : undefined,
      }));

    const durationMs = Date.now() - start;
    console.log(`✅ LLM goals evaluation completed in ${durationMs}ms, steps=${normalized.length}`);
    console.log(
      `🤖 Evaluation model used: requested=${String(evalConfig.model)}, actual=${String(completion.model)}, default=${String(config.ai.openai.evalProfile?.model)}`,
    );
    return { steps: normalized };
  }

  /**
   * Attempt to parse JSON allowing common formatting such as code fences.
   */
  private parseJsonLax(text: string): any {
    try {
      return JSON.parse(text);
    } catch {}
    try {
      const match = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```\s*([\s\S]*?)\s*```/i);
      if (match && match[1]) {
        return JSON.parse(match[1]);
      }
    } catch {}
    try {
      // Fallback: extract first JSON object
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1));
      }
    } catch {}
    return {};
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
      console.log('🤖 Initializing Transformers microservice connection...');
      
      const isAvailable = await transformersService.isAvailable();
      
      if (isAvailable) {
        const healthInfo = await transformersService.getHealthInfo();
        if (healthInfo) {
          console.log(`✅ Transformers microservice ready - Models: ${String(healthInfo.models_loaded.join(', '))}`);
          console.log(`📊 Service status: ${String(healthInfo.message)}`);
        } else {
          console.log('✅ Transformers microservice is available');
        }
      } else {
        console.log('⚠️ Transformers microservice not available, using fallback analysis');
      }
      
    } catch (error) {
      console.warn('🚨 Failed to initialize transformers microservice:', error);
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
      console.error('🚨 Error loading system prompts from database, using defaults:', error);
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
   * Build a stable cache key for RAG context based on session if available
   */
  private getSessionCacheKey(context: ConversationContext): string {
    const history = Array.isArray(context.conversationHistory) ? context.conversationHistory : [];
    const firstMsg = history[0];
    const lastMsg = history.length > 0 ? history[history.length - 1] : undefined;
    const sessionId = firstMsg?.sessionId || lastMsg?.sessionId;
    if (sessionId) return `session:${sessionId}`;
    const simId = (context.simulation as any)?.id || 'unknown_sim';
    const personaId = (context.persona as any)?.id || 'unknown_persona';
    return `sim:${simId}:persona:${personaId}`;
  }

  /**
   * Get or compute the RAG context once per session and cache it
   */
  private async getOrBuildRagContextOnce(context: ConversationContext, query: string): Promise<string> {
    const cacheKey = this.getSessionCacheKey(context);
    if (this.ragContextCache.has(cacheKey)) {
      return this.ragContextCache.get(cacheKey) as string;
    }
    try {
      const available = await RAGService.isAvailable();
      if (!available) {
        this.ragContextCache.set(cacheKey, '');
        return '';
      }
      const ragContext = await RAGService.buildRagContextForConversation({
        persona: context.persona,
        simulation: context.simulation,
        query,
      });
      this.ragContextCache.set(cacheKey, ragContext || '');
      return ragContext || '';
    } catch {
      this.ragContextCache.set(cacheKey, '');
      return '';
    }
  }

  /**
   * Build a dynamic RAG query using the latest user messages
   */
  private buildDynamicRagQuery(context: ConversationContext, explicitUserMessage?: string): string {
    const recentUserMessages = this.getLastUserMessages(context.conversationHistory, 3);
    const candidateTexts: string[] = [];
    if (explicitUserMessage && explicitUserMessage.trim().length > 0) {
      candidateTexts.push(explicitUserMessage.trim());
    }
    for (const message of recentUserMessages) {
      if (typeof message?.content === 'string' && message.content.trim().length > 0) {
        candidateTexts.push(message.content.trim());
      }
    }
    // Deduplicate while preserving recency
    const deduped = Array.from(new Set(candidateTexts)).slice(-3);
    const queryParts = [
      deduped.join(' | '),
      context.simulation?.title || '',
      context.simulation?.scenario || '',
    ].filter(Boolean);
    return queryParts.join(' | ');
  }

  /**
   * Get per-turn cache key for RAG context using session and last user seq
   * For proactive messages, also include the last AI sequence to avoid cache reuse during bursts
   */
  private getPerTurnRagCacheKey(context: ConversationContext, explicitUserMessage?: string): string {
    const sessionKey = this.getSessionCacheKey(context);
    const lastUser = this.getLastUserMessages(context.conversationHistory, 1)[0];
    const userSequence = lastUser?.sequenceNumber || 0;
    
    // Include last AI sequence number to break cache during AI message bursts
    const lastAi = [...(context.conversationHistory || [])]
      .reverse()
      .find(m => m.type === MessageType.AI || (m as any)?.isFromAI);
    const aiSequence = lastAi?.sequenceNumber || 0;
    
    const signatureSource = (explicitUserMessage && explicitUserMessage.length > 0)
      ? explicitUserMessage
      : (lastUser?.content || context.simulation?.title || context.persona?.name || '');
    const signature = this.simpleHash(signatureSource);
    return `${sessionKey}:turn:u${userSequence}:a${aiSequence}:sig:${signature}`;
  }

  /**
   * Compute or fetch RAG context for the current turn based on latest user input
   */
  private async getOrBuildRagContextForTurn(context: ConversationContext, explicitUserMessage?: string): Promise<string> {
    try {
      const available = await RAGService.isAvailable();
      if (!available) {
        return '';
      }

      const cacheKey = this.getPerTurnRagCacheKey(context, explicitUserMessage);
      if (this.ragTurnContextCache.has(cacheKey)) {
        return this.ragTurnContextCache.get(cacheKey) as string;
      }

      const query = this.buildDynamicRagQuery(context, explicitUserMessage);
      const rawRag = await RAGService.buildRagContextForConversation({
        persona: context.persona,
        simulation: context.simulation,
        query,
      });

      const ragSection = rawRag
        ? [
          '[Grounding knowledge]',
          'Use the following retrieved snippets to ground your answer only if relevant. Do not invent facts not supported here.',
          'Synthesize naturally and avoid quoting verbatim unless explicitly asked.',
          rawRag,
        ].join('\n')
        : '';

      this.ragTurnContextCache.set(cacheKey, ragSection);
      return ragSection;
    } catch {
      return '';
    }
  }

  /**
   * Utility: get the last N user messages from history
   */
  private getLastUserMessages(messages: SessionMessage[], maxCount: number): SessionMessage[] {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const userMessages = messages.filter((m) => {
      const isUserByType = (m as any)?.type === MessageType.USER;
      const isUserByFlag = (m as any)?.isFromUser === true;
      return isUserByType || isUserByFlag;
    });
    return userMessages
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .slice(-Math.max(1, maxCount));
  }

  /**
   * Utility: simple non-cryptographic hash for cache signatures
   */
  private simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      // hash = hash * 31 + char
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
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
      const [aiSettings, systemPrompts] = await Promise.all([
        this.getAIConfig(),
        this.getSystemPrompts(),
      ]);

      const genConfig = this.resolveAIProfile(aiSettings, 'generation');

      const conversationMessages = this.buildConversationHistory(context.conversationHistory);

      // Build RAG context dynamically for this turn using latest user input
      const ragContext = await this.getOrBuildRagContextForTurn(context, userMessage);
      const systemPrompt = this.buildSystemPrompt(context, systemPrompts.baseSystemPrompt, ragContext);

      const completion = await this.openai.chat.completions.create({
        model: genConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationMessages,
          { role: 'user', content: userMessage },
        ],
        max_tokens: genConfig.maxTokens,
        temperature: genConfig.temperature,
        frequency_penalty: genConfig.frequencyPenalty,
        presence_penalty: genConfig.presencePenalty,
        top_p: genConfig.topP,
      });

      const response = completion.choices[0]?.message?.content || '';
      const processingTime = Date.now() - startTime;

      // Run external analyses in parallel and reuse their results
      const [emotionAnalysis, sentimentAnalysis, assessmentBundle] = await Promise.all([
        this.analyzeEmotionalToneWithConfidence(response, context.persona),
        this.analyzeSentimentWithConfidence(response),
        (async () => {
          try {
            const [overall, coherence, relevance, completeness, personaAlignment] = await Promise.all([
              this.assessOverallQuality(response, context).catch(() => 0),
              this.assessResponseCoherence(response).catch(() => 0),
              this.assessResponseRelevance(response, context).catch(() => 0),
              this.assessResponseCompleteness(response, context).catch(() => 0),
              this.assessPersonaAlignment(response, context.persona).catch(() => 0),
            ]);
            return { overall, coherence, relevance, completeness, personaAlignment } as const;
          } catch {
            return undefined;
          }
        })(),
      ]);

      // Calculate overall confidence using precomputed assessment scores when available
      const confidence = await this.calculateOverallConfidence(
        emotionAnalysis,
        sentimentAnalysis,
        response,
        context,
        assessmentBundle,
      );
      
      // Store quality assessment scores for analytics (reuse precomputed if available)
      const qualityScores = await this.getQualityAssessmentScores(response, context, assessmentBundle);

      return {
        message: response,
        emotionalTone: emotionAnalysis.tone,
        confidence,
        processingTime,
        metadata: {
          tokenCount: completion.usage?.total_tokens || 0,
          model: completion.model,
          sentiment: sentimentAnalysis.sentiment,
          // Include full analysis results for reuse
          emotionAnalysis: {
            emotion: emotionAnalysis.tone,
            confidence: emotionAnalysis.confidence,
          },
          sentimentAnalysis: {
            sentiment: sentimentAnalysis.sentiment,
            confidence: sentimentAnalysis.confidence,
          },
          qualityScores,
        },
      };
    } catch (error) {
      console.error('🚨 Error generating AI response:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  /**
   * Generate a proactive persona message (no immediate user input required)
   */
  async generateProactivePersonaMessage(
    context: ConversationContext,
    options: { reason: ProactiveReason; lastUserMessage?: string; previousAiMessage?: string },
  ): Promise<AIResponse> {
    const startTime = Date.now();

    const { reason, lastUserMessage, previousAiMessage } = options;
    const { persona } = context;

    try {
      const [aiSettings, systemPrompts] = await Promise.all([
        this.getAIConfig(),
        this.getSystemPrompts(),
      ]);

      const genConfig = this.resolveAIProfile(aiSettings, 'generation');
      
      // Boost temperature and penalties for proactive messages to increase variety
      // This helps prevent repetitive responses in burst scenarios
      const proactiveConfig = {
        ...genConfig,
        temperature: Math.min(1.0, genConfig.temperature * 1.25), // Increase by 25%
        frequencyPenalty: Math.min(2.0, genConfig.frequencyPenalty + 0.3), // Stronger penalty
        presencePenalty: Math.min(2.0, genConfig.presencePenalty + 0.2), // Stronger penalty
      };

      const conversationMessages = this.buildConversationHistory(context.conversationHistory);

      // Build RAG context dynamically for this turn using latest user input
      const ragContext = await this.getOrBuildRagContextForTurn(context, lastUserMessage);
      const systemPrompt = this.buildSystemPrompt(context, systemPrompts.baseSystemPrompt, ragContext);

      // Steering instruction for proactive message
      const personaHints = persona.conversationStyle || {} as any;
      const openingStyle = (personaHints.openingStyle || '').toString();
      const nudgeStyle = (personaHints.nudgeStyle || '').toString();

      // Get recent AI messages for better repetition context
      const recentAiMessages = [...(context.conversationHistory || [])]
        .filter(m => m.type === MessageType.AI || (m as any)?.isFromAI)
        .slice(-3)
        .map(m => m.content);

      const steering = (() => {
        switch (reason) {
        case 'start':
          return `Act first with a natural opening line consistent with the persona. ${openingStyle ? `Opening style hint: ${openingStyle}.` : ''} Keep it concise and engaging. Introduce yourself or the topic freshly.`;
        case 'inactivity':
          return `Send a polite, in-character nudge to re-engage after user silence. ${nudgeStyle ? `Nudge style hint: ${nudgeStyle}.` : ''} Keep it short and friendly. Use a different angle than any previous nudges.`;
        case 'backchannel':
          return 'Send a brief backchannel request for clarification or elaboration. Keep it very short. Ask about something specific they mentioned.';
        case 'followup':
        default:
          return 'Add a short follow-up that advances the conversation naturally. Introduce NEW information, ask a NEW question, or share a DIFFERENT perspective. NEVER repeat phrases or ideas from your recent messages.';
        }
      })();

      const antiRepetitionGuidance = recentAiMessages.length > 0
        ? [
          '\n[CRITICAL: Anti-repetition rules]',
          `You recently said: ${recentAiMessages.map((msg, i) => `(${i + 1}) "${msg.slice(0, 100)}..."`).join('; ')}`,
          'Your new message MUST:',
          '- Use completely different vocabulary and phrasing',
          '- Introduce a new topic, angle, or specific detail not yet mentioned',
          '- Never reuse sentence structures or patterns from above',
          '- If asking a question, make it about something entirely different',
          '- If sharing information, provide a new fact or perspective',
        ].join('\n')
        : '';

      const userInstruction = [
        '[Proactive action]',
        steering,
        lastUserMessage ? `Last user input to consider: ${lastUserMessage}` : '',
        previousAiMessage ? `Most recent AI message (DO NOT repeat any of its content): ${previousAiMessage}` : '',
        antiRepetitionGuidance,
      ].filter(Boolean).join('\n');

      const completion = await this.openai.chat.completions.create({
        model: proactiveConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationMessages,
          { role: 'user', content: userInstruction },
        ],
        max_tokens: proactiveConfig.maxTokens,
        temperature: proactiveConfig.temperature,
        frequency_penalty: proactiveConfig.frequencyPenalty,
        presence_penalty: proactiveConfig.presencePenalty,
        top_p: proactiveConfig.topP,
      });

      const response = completion.choices[0]?.message?.content || '';
      const processingTime = Date.now() - startTime;

      // Lightweight analysis to keep parity with normal generation
      const [emotionAnalysis, sentimentAnalysis] = await Promise.all([
        this.analyzeEmotionalToneWithConfidence(response, context.persona),
        this.analyzeSentimentWithConfidence(response),
      ]);

      const confidence = this.calculateBasicConfidence(emotionAnalysis, sentimentAnalysis);

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
      console.error('🚨 Error generating proactive AI message:', error);
      throw new Error('Failed to generate proactive AI message');
    }
  }

  /**
   * Build system prompt for the AI persona using configurable template
   */
  private buildSystemPrompt(context: ConversationContext, promptTemplate: string, ragContext?: string): string {
    const { persona, simulation } = context;

    // Replace template variables with actual values
    const basePrompt = promptTemplate
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

    // Attempt to include DB-driven style guidelines if available in cache
    let styleGuidelines: string | undefined;
    try {
      const prompts = this.configCache.get('system_prompts');
      styleGuidelines = prompts?.styleGuidelines;
    } catch {}

    const parts: string[] = [basePrompt];
    if (styleGuidelines) parts.push(styleGuidelines);
    if (ragContext) parts.push(ragContext);
    return parts.join('\n\n');
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
   * Analyze emotional tone with confidence score using transformers microservice
   */
  private async analyzeEmotionalToneWithConfidence(response: string, _persona: Persona): Promise<{ tone: string; confidence: number }> {
    try {
      const emotionResult = await transformersService.analyzeEmotion(response);
      
      // Only log a remote success here; fallback already logged inside the transformers client
      if (emotionResult.source !== 'fallback') {
        console.log(`Transformers emotion analysis: ${String(emotionResult.emotion)} (${Number(emotionResult.confidence).toFixed(3)})`);
      }
      return { tone: emotionResult.emotion, confidence: emotionResult.confidence };
      
    } catch (error: any) {
      console.warn('🔄 Transformers emotion analysis failed, using fallback:', error.message);
      // Use transformers service fallback method
      const fallbackResult = transformersService.analyzeEmotionFallback(response);
      return { tone: fallbackResult.emotion, confidence: fallbackResult.confidence };
    }
  }



  /**
   * Analyze sentiment with confidence score using transformers microservice
   */
  private async analyzeSentimentWithConfidence(response: string): Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; confidence: number }> {
    try {
      const sentimentResult = await transformersService.analyzeSentiment(response);
      
      // Only log a remote success here; fallback already logged inside the transformers client
      if (sentimentResult.source !== 'fallback') {
        console.log(`Transformers sentiment analysis: ${String(sentimentResult.sentiment)} (${Number(sentimentResult.confidence).toFixed(3)})`);
      }
      return sentimentResult;
      
    } catch (error: any) {
      console.warn('🔄 Transformers sentiment analysis failed, using fallback:', error.message);
      // Use transformers service fallback method
      const fallbackResult = transformersService.analyzeSentimentFallback(response);
      return fallbackResult;
    }
  }



  /**
   * Calculate overall confidence using multiple approaches including transformer-based assessment
   */
  private async calculateOverallConfidence(
    emotionAnalysis: { tone: string; confidence: number },
    sentimentAnalysis: { sentiment: 'positive' | 'neutral' | 'negative'; confidence: number },
    response: string,
    context: ConversationContext,
    precomputedAssessments?: { overall: number; coherence: number; relevance: number; completeness: number; personaAlignment: number },
  ): Promise<number> {
    try {
      // Get transformer-based confidence assessment if available
      const transformerConfidence = await this.getTransformerConfidenceScore(
        response,
        context,
        precomputedAssessments,
      );
      
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
      console.warn('🔄 Advanced confidence calculation failed, using fallback:', error.message);
      return this.calculateBasicConfidence(emotionAnalysis, sentimentAnalysis);
    }
  }

  /**
   * Get confidence score using transformers-based text quality assessment
   */
  private async getTransformerConfidenceScore(
    response: string,
    context: ConversationContext,
    precomputedAssessments?: { overall: number; coherence: number; relevance: number; completeness: number; personaAlignment: number },
  ): Promise<number> {
    try {
      // If assessments were precomputed, reuse them to avoid duplicate work
      if (precomputedAssessments) {
        const { overall, coherence, relevance, completeness, personaAlignment } = precomputedAssessments;

        const overallQualityWeight = 0.3;
        const coherenceWeight = 0.2;
        const relevanceWeight = 0.2;
        const completenessWeight = 0.1;
        const personaAlignmentWeight = 0.2;

        const confidence = (overall * overallQualityWeight) +
                          (coherence * coherenceWeight) +
                          (relevance * relevanceWeight) +
                          (completeness * completenessWeight) +
                          (personaAlignment * personaAlignmentWeight);

        console.log(`Transformers confidence (reused): quality=${Number(overall).toFixed(3)}, coherence=${Number(coherence).toFixed(3)}, relevance=${Number(relevance).toFixed(3)}, completeness=${Number(completeness).toFixed(3)}, persona=${Number(personaAlignment).toFixed(3)} -> ${Number(confidence).toFixed(3)}`);
        return confidence;
      }

      // Check if transformers microservice is available
      const isAvailable = await transformersService.isAvailable();
      if (!isAvailable) {
        console.log('🔄 Transformers confidence assessment fallback: using heuristics');
        return this.getHeuristicConfidenceScore(response, context);
      }

      // Use a multi-faceted approach combining transformer-based and traditional assessments
      const assessments = await Promise.all([
        this.assessOverallQuality(response, context),
        this.assessResponseCoherence(response),
        this.assessResponseRelevance(response, context),
        this.assessResponseCompleteness(response, context),
        this.assessPersonaAlignment(response, context.persona),
      ]);

      // Combine the assessments with weights (balanced across all dimensions)
      const overallQualityWeight = 0.3;
      const coherenceWeight = 0.2;
      const relevanceWeight = 0.2;
      const completenessWeight = 0.1;
      const personaAlignmentWeight = 0.2;

      const confidence = (assessments[0] * overallQualityWeight) + 
                        (assessments[1] * coherenceWeight) + 
                        (assessments[2] * relevanceWeight) + 
                        (assessments[3] * completenessWeight) + 
                        (assessments[4] * personaAlignmentWeight);

      console.log(`Transformers confidence: quality=${Number(assessments[0]).toFixed(3)}, coherence=${Number(assessments[1]).toFixed(3)}, relevance=${Number(assessments[2]).toFixed(3)}, completeness=${Number(assessments[3]).toFixed(3)}, persona=${Number(assessments[4]).toFixed(3)} -> ${Number(confidence).toFixed(3)}`);
      return confidence;

    } catch (error) {
      console.warn('🔄 Transformers confidence assessment failed, using fallback:', (error as any).message);
      return this.getHeuristicConfidenceScore(response, context);
    }
  }

  /**
   * Assess response coherence using text classification
   */
  private async assessResponseCoherence(response: string): Promise<number> {
    try {
      // Use enhanced analysis combining rule-based and transformer-based assessment
      const [logicalFlowScore, complexityScore] = await Promise.all([
        this.assessLogicalFlow(response),
        this.assessComplexity(response),
      ]);

      const basicQualityIndicators = {
        hasProperSentenceStructure: /^[A-Z].*[.!?]$/.test(response.trim()) ? 1 : 0,
        hasReasonableLength: (response.length >= 10 && response.length <= 500) ? 1 : 0,
        hasNoRepeatedPhrases: !/((.+)\1{2,})/.test(response) ? 1 : 0,
        hasVariedVocabulary: (new Set(response.toLowerCase().split(/\W+/)).size > response.split(/\W+/).length * 0.3) ? 1 : 0,
        hasProperPunctuation: /[.!?]/.test(response) ? 1 : 0,
        logicalFlowScore,
        complexityScore,
      };

      const scores = Object.values(basicQualityIndicators);
      return scores.reduce((sum, score) => sum + score, 0) / scores.length;

    } catch (error) {
      console.warn('🔄 Coherence assessment failed, using fallback:', error.message);
      return 0.5;
    }
  }

  /**
   * Assess logical flow of the response using zero-shot classification
   */
  private async assessLogicalFlow(response: string): Promise<number> {
    try {
      // Use zero-shot classification to assess logical flow
      const result = await transformersService.classifySequence(response, [
        'logically coherent',
        'somewhat coherent', 
        'logically inconsistent',
      ]);
      
      // Convert classification result to numeric score
      const scoreMap: Record<string, number> = {
        'logically coherent': 1.0,
        'somewhat coherent': 0.6,
        'logically inconsistent': 0.2,
      };
      
      return scoreMap[result.label] || 0.5;
      
    } catch (error) {
      console.warn('🔄 Zero-shot logical flow assessment failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
      return this.assessLogicalFlowFallback(response);
    }
  }

  /**
   * Fallback logical flow assessment using rule-based approach
   */
  private assessLogicalFlowFallback(response: string): number {
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length <= 1) return 1.0; // Single sentence is considered coherent
    
    // Check for transition words/phrases that indicate logical flow
    const transitionWords = ['however', 'therefore', 'moreover', 'furthermore', 'additionally', 
      'consequently', 'meanwhile', 'similarly', 'in contrast', 'for example'];
    
    const hasTransitions = sentences.some(sentence => 
      transitionWords.some(word => sentence.toLowerCase().includes(word)),
    );
    
    // Check for pronoun consistency (basic check)
    const pronounPattern = /\b(it|they|this|that|these|those)\b/gi;
    const hasPronouns = sentences.some(sentence => pronounPattern.test(sentence));
    
    return hasTransitions || hasPronouns || sentences.length <= 3 ? 0.8 : 0.4;
  }

  /**
   * Assess complexity appropriateness using zero-shot classification
   */
  private async assessComplexity(response: string): Promise<number> {
    try {
      // Use zero-shot classification to assess complexity appropriateness
      const result = await transformersService.classifySequence(response, [
        'appropriately complex',
        'too simple',
        'overly complex',
        'well-balanced complexity',
      ]);
      
      // Convert classification result to numeric score
      const scoreMap: Record<string, number> = {
        'appropriately complex': 1.0,
        'well-balanced complexity': 1.0,
        'too simple': 0.4,
        'overly complex': 0.3,
      };
      
      return scoreMap[result.label] || 0.6;
      
    } catch (error) {
      console.warn('🔄 Zero-shot complexity assessment failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
      return this.assessComplexityFallback(response);
    }
  }

  /**
   * Fallback complexity assessment using rule-based approach
   */
  private assessComplexityFallback(response: string): number {
    const words = response.split(/\s+/);
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    const complexWords = words.filter(word => word.length > 6).length;
    const complexityRatio = complexWords / words.length;
    
    // Appropriate complexity: not too simple, not overly complex
    const isAppropriate = avgWordLength >= 3.5 && avgWordLength <= 8 && complexityRatio >= 0.1 && complexityRatio <= 0.4;
    return isAppropriate ? 1.0 : 0.5;
  }

  /**
   * Assess overall response quality using zero-shot classification
   */
  private async assessOverallQuality(response: string, _context: ConversationContext): Promise<number> {
    try {
      // Use zero-shot classification to assess overall response quality
      const result = await transformersService.classifySequence(response, [
        'high quality response',
        'good quality response',
        'average quality response',
        'poor quality response',
        'excellent professional response',
      ]);
      
      // Convert classification result to numeric score
      const scoreMap: Record<string, number> = {
        'excellent professional response': 1.0,
        'high quality response': 0.9,
        'good quality response': 0.7,
        'average quality response': 0.5,
        'poor quality response': 0.2,
      };
      
      const qualityScore = scoreMap[result.label] || 0.5;
      
      // Also assess appropriateness for the specific context (persona/simulation)
      const contextResult = await transformersService.classifySequence(response, [
        'appropriate for professional conversation',
        'appropriate for business context', 
        'too casual for context',
        'too formal for context',
        'perfectly matches expected tone',
      ]);
      
      const contextMap: Record<string, number> = {
        'perfectly matches expected tone': 1.0,
        'appropriate for professional conversation': 0.9,
        'appropriate for business context': 0.8,
        'too casual for context': 0.4,
        'too formal for context': 0.5,
      };
      
      const contextScore = contextMap[contextResult.label] || 0.6;
      
      // Combine quality and context scores
      return (qualityScore * 0.7) + (contextScore * 0.3);
      
    } catch (error) {
      console.warn('🔄 Zero-shot quality assessment failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
      return 0.6; // Default moderate score
    }
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
      console.warn('🔄 Relevance assessment failed, using fallback:', error.message);
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
      console.warn('🔄 Completeness assessment failed, using fallback:', error.message);
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
   * Assess persona appropriateness using zero-shot classification
   */
  private async assessPersonaAlignment(response: string, persona: Persona): Promise<number> {
    try {
      // Create dynamic labels based on persona characteristics
      const personaLabels = [
        `matches ${persona.role} speaking style`,
        `appropriate for ${persona.personality} personality`,
        'too formal for this persona',
        'too casual for this persona',
        'perfectly embodies this character',
      ];

      const result = await transformersService.classifySequence(response, personaLabels);
      
      // Convert classification result to numeric score
      const scoreMap: Record<string, number> = {
        [`matches ${persona.role} speaking style`]: 0.8,
        [`appropriate for ${persona.personality} personality`]: 0.8,
        ['perfectly embodies this character']: 1.0,
        ['too formal for this persona']: 0.3,
        ['too casual for this persona']: 0.3,
      };
      
      const score = scoreMap[result.label];
      if (score !== undefined) {
        console.log(`👤 Persona alignment: ${String(result.label)} (${Number(result.confidence).toFixed(3)}) -> ${Number(score)}`);
        return score * result.confidence; // Weight by confidence
      }
      
      // If no exact match, use confidence as the score
      return result.confidence;
      
    } catch (error) {
      console.warn('🔄 Zero-shot persona alignment assessment failed, using fallback:', error instanceof Error ? error.message : 'Unknown error');
      return 0.6; // Default moderate alignment score
    }
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
   * Get comprehensive quality assessment scores for analytics
   * This method runs assessments in parallel and caches results
   */
  private async getQualityAssessmentScores(
    response: string,
    context: ConversationContext,
    precomputedAssessments?: { overall: number; coherence: number; relevance: number; completeness: number; personaAlignment: number },
  ): Promise<AIResponse['metadata']['qualityScores']> {
    try {
      // Check if transformers service is available
      const isAvailable = await transformersService.isAvailable();
      
      // If provided, reuse precomputed assessment results only when service is available
      if (precomputedAssessments) {
        if (!isAvailable) return undefined;
        return {
          overall: precomputedAssessments.overall,
          coherence: precomputedAssessments.coherence,
          relevance: precomputedAssessments.relevance,
          completeness: precomputedAssessments.completeness,
          personaAlignment: precomputedAssessments.personaAlignment,
        };
      }

      if (!isAvailable) {
        return undefined; // Skip if service not available
      }

      // Run all assessments in parallel for efficiency
      const [overall, coherence, relevance, completeness, personaAlignment] = await Promise.all([
        this.assessOverallQuality(response, context).catch(() => 0),
        this.assessResponseCoherence(response).catch(() => 0),
        this.assessResponseRelevance(response, context).catch(() => 0),
        this.assessResponseCompleteness(response, context).catch(() => 0),
        this.assessPersonaAlignment(response, context.persona).catch(() => 0),
      ]);

      return {
        overall,
        coherence,
        relevance,
        completeness,
        personaAlignment,
      };
    } catch (error) {
      console.warn('Failed to get quality assessment scores:', error);
      return undefined;
    }
  }
} 