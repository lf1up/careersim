import OpenAI from 'openai';
import { config } from '@/config/env';
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
  
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.ai.openai.apiKey,
    });
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
      const systemPrompt = this.buildSystemPrompt(context);
      const conversationMessages = this.buildConversationHistory(context.conversationHistory);

      const completion = await this.openai.chat.completions.create({
        model: config.ai.openai.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationMessages,
          { role: 'user', content: userMessage },
        ],
        max_tokens: config.ai.openai.maxTokens,
        temperature: 0.8,
        frequency_penalty: 0.3,
        presence_penalty: 0.3,
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
   * Build system prompt for the AI persona
   */
  private buildSystemPrompt(context: ConversationContext): string {
    const { persona, simulation } = context;
    
    return `You are ${persona.name}, ${persona.role}. 

PERSONALITY & BACKGROUND:
${persona.personality}

SIMULATION CONTEXT:
You are participating in a professional simulation: "${simulation.title}"
Scenario: ${simulation.scenario}
Objectives: ${simulation.objectives}

YOUR ROLE IN THIS SIMULATION:
Primary Goal: ${persona.primaryGoal}
Hidden Motivation: ${persona.hiddenMotivation}

BEHAVIORAL GUIDELINES:
1. Stay in character as ${persona.name} at all times
2. Respond authentically based on your personality and motivations
3. Show emotional depth and react naturally to the user's approach
4. If the user demonstrates understanding of your hidden motivation, gradually become more cooperative
5. Challenge the user appropriately based on your personality
6. Keep responses conversational and realistic (2-4 sentences typically)
7. Show personality quirks and speech patterns consistent with your role

CONVERSATION STYLE:
${persona.conversationStyle ? JSON.stringify(persona.conversationStyle, null, 2) : 'Natural, professional conversation'}

DIFFICULTY LEVEL: ${persona.difficultyLevel}/5
${persona.difficultyLevel >= 4 ? 'You should be quite challenging and require skilled communication to win over.' : 'You can be moderately cooperative if approached well.'}

Remember: You are NOT an AI assistant. You are ${persona.name}, and you have your own agenda and feelings. React accordingly.`;
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
    const dominantTone = Object.keys(toneScores).reduce((a, b) => 
      toneScores[a] > toneScores[b] ? a : b
    );

    return toneScores[dominantTone] > 0 ? dominantTone : 'neutral';
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
   * Generate performance feedback based on conversation
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
    const userMessagesText = userMessages
      .filter(msg => msg.type === MessageType.USER)
      .map(msg => msg.content)
      .join('\n');

    const analysisPrompt = `Analyze this user's performance in a simulation with ${context.persona.name} (${context.persona.role}).

Simulation: ${context.simulation.title}
Persona's Goal: ${context.persona.primaryGoal}
Persona's Hidden Motivation: ${context.persona.hiddenMotivation}

User's messages:
${userMessagesText}

Provide detailed feedback in JSON format:
{
  "overallFeedback": "2-3 sentence summary of performance",
  "strengths": ["specific strength 1", "specific strength 2"],
  "improvementAreas": ["area for improvement 1", "area for improvement 2"],
  "specificSuggestions": ["actionable suggestion 1", "actionable suggestion 2"]
}

Focus on communication skills, emotional intelligence, problem-solving, and how well they understood and addressed the persona's motivations.`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: config.ai.openai.model,
        messages: [{ role: 'user', content: analysisPrompt }],
        max_tokens: 1000,
        temperature: 0.3,
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