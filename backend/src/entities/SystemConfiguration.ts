import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface AIModelSettings {
  model: string;
  maxTokens: number;
  temperature: number;
  frequencyPenalty: number;
  presencePenalty: number;
  topP: number;
  // Optional task-specific overrides without breaking existing shape
  profiles?: {
    generation?: Partial<AIModelSettings>;
    evaluation?: Partial<AIModelSettings>;
  };
}

export interface SystemPrompts {
  baseSystemPrompt: string;
  performanceAnalysisPrompt: string;
  styleGuidelines?: string;
  // Add more prompts as needed
}

export interface RateLimitSettings {
  windowMs: number;
  maxRequests: number;
  enabled: boolean;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     SystemConfiguration:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "123e4567-e89b-12d3-a456-426614174000"
 *         configKey:
 *           type: string
 *           example: "AI_MODEL_SETTINGS"
 *         aiModelSettings:
 *           type: object
 *           properties:
 *             model:
*               type: string
*               example: "moonshotai/kimi-k2:free"
 *             maxTokens:
 *               type: integer
 *               example: 2000
 *             temperature:
 *               type: number
 *               format: float
 *               example: 0.8
 *             frequencyPenalty:
 *               type: number
 *               format: float
 *               example: 0.3
 *             presencePenalty:
 *               type: number
 *               format: float
 *               example: 0.3
 *             topP:
 *               type: number
 *               format: float
 *               example: 1.0
 *             profiles:
 *               type: object
 *               properties:
 *                 generation:
 *                   type: object
 *                   description: "Overrides for persona response generation"
 *                 evaluation:
 *                   type: object
 *                   description: "Generic overrides for the evaluations service"
 *         systemPrompts:
 *           type: object
 *           properties:
 *             baseSystemPrompt:
 *               type: string
 *               example: "You are {persona.name}, {persona.role}..."
 *             performanceAnalysisPrompt:
 *               type: string
 *               example: "Analyze this user's performance..."
 *         rateLimitSettings:
 *           type: object
 *           properties:
 *             windowMs:
 *               type: integer
 *               example: 900000
 *             maxRequests:
 *               type: integer
 *               example: 100
 *             enabled:
 *               type: boolean
 *               example: true
 *         isActive:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */
@Entity('system_configurations')
export class SystemConfiguration {
  @PrimaryGeneratedColumn('uuid')
    id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
    configKey!: string;

  @Column({ type: 'json', nullable: true })
    aiModelSettings?: AIModelSettings;

  @Column({ type: 'json', nullable: true })
    systemPrompts?: SystemPrompts;

  @Column({ type: 'json', nullable: true })
    rateLimitSettings?: RateLimitSettings;

  @Column({ type: 'text', nullable: true })
    description?: string;

  @Column({ type: 'boolean', default: true })
    isActive!: boolean;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;

  // Helper methods for common configuration keys
  static readonly CONFIG_KEYS = {
    AI_MODEL_SETTINGS: 'AI_MODEL_SETTINGS',
    SYSTEM_PROMPTS: 'SYSTEM_PROMPTS',
    RATE_LIMIT_SETTINGS: 'RATE_LIMIT_SETTINGS',
  } as const;

  // Default configurations
  static getDefaultAISettings(): AIModelSettings {
    // Import config here to avoid circular dependencies
    const { config } = require('@/config/env');
    
    return {
      model: config.ai.openai.model,
      maxTokens: config.ai.openai.maxTokens,
      temperature: (config.ai.openai.temperature ?? 0.8),
      frequencyPenalty: (config.ai.openai.frequencyPenalty ?? 0.3),
      presencePenalty: (config.ai.openai.presencePenalty ?? 0.3),
      topP: (config.ai.openai.topP ?? 1.0),
      profiles: {
        generation: {
          model: config.ai.openai.generationModel ?? config.ai.openai.model,
          maxTokens: config.ai.openai.maxTokens,
          temperature: (config.ai.openai.temperature ?? 0.8),
          frequencyPenalty: (config.ai.openai.frequencyPenalty ?? 0.3),
          presencePenalty: (config.ai.openai.presencePenalty ?? 0.3),
          topP: (config.ai.openai.topP ?? 1.0),
        },
        evaluation: {
          model: (config.ai.openai.evalProfile?.model ?? config.ai.openai.model),
          maxTokens: (config.ai.openai.evalProfile?.maxTokens ?? Math.min(2000, config.ai.openai.maxTokens)),
          temperature: (config.ai.openai.evalProfile?.temperature ?? 0.3),
          frequencyPenalty: (config.ai.openai.evalProfile?.frequencyPenalty ?? (config.ai.openai.frequencyPenalty ?? 0.3)),
          presencePenalty: (config.ai.openai.evalProfile?.presencePenalty ?? (config.ai.openai.presencePenalty ?? 0.3)),
          topP: (config.ai.openai.evalProfile?.topP ?? (config.ai.openai.topP ?? 1.0)),
        },
      },
    };
  }

  static getDefaultSystemPrompts(): SystemPrompts {
    return {
      baseSystemPrompt: `You are {persona.name}, {persona.role}. 

PERSONALITY & BACKGROUND:
{persona.personality}

SIMULATION CONTEXT:
You are participating in a professional simulation: "{simulation.title}"
Scenario: {simulation.scenario}
Objectives: {simulation.objectives}

YOUR ROLE IN THIS SIMULATION:
Primary Goal: {persona.primaryGoal}
Hidden Motivation: {persona.hiddenMotivation}

BEHAVIORAL GUIDELINES:
1. Stay in character as {persona.name} at all times
2. Respond authentically based on your personality and motivations
3. Show emotional depth and react naturally to the user's approach
4. If the user demonstrates understanding of your hidden motivation, gradually become more cooperative
5. Challenge the user appropriately based on your personality
6. Keep responses conversational and realistic (2-4 sentences typically)
7. Show personality quirks and speech patterns consistent with your role

CONVERSATION STYLE:
{persona.conversationStyle ? JSON.stringify(persona.conversationStyle, null, 2) : 'Natural, professional conversation'}

DIFFICULTY LEVEL: {persona.difficultyLevel}/5
{persona.difficultyLevel >= 4 ? 'You should be quite challenging and require skilled communication to win over.' : 'You can be moderately cooperative if approached well.'}

Remember: You are NOT an AI assistant. You are {persona.name}, and you have your own agenda and feelings. React accordingly.`,

      performanceAnalysisPrompt: `Analyze this user's performance in a simulation with {persona.name} ({persona.role}).

Simulation: {simulation.title}
Persona's Goal: {persona.primaryGoal}
Persona's Hidden Motivation: {persona.hiddenMotivation}

User's messages:
{userMessages}

Provide detailed feedback in JSON format:
{
  "overallFeedback": "2-3 sentence summary of performance",
  "strengths": ["specific strength 1", "specific strength 2"],
  "improvementAreas": ["area for improvement 1", "area for improvement 2"],
  "specificSuggestions": ["actionable suggestion 1", "actionable suggestion 2"]
}

Focus on communication skills, emotional intelligence, problem-solving, and how well they understood and addressed the persona's motivations.`,

      styleGuidelines: `STYLE AND OUTPUT RULES:
1) Do not include stage directions, physical actions, or emotions as asterisks or in parentheses (e.g., *sighs*, (smiles)). Speak only the words you would actually say.
2) Do not use bracketed emotes, third-person narration, or screenplay-style cues.
3) If you provide any code, output it as a separate fenced Markdown code block with the correct language tag. Keep prose outside the code block.`,
    };
  }

  static getDefaultRateLimitSettings(): RateLimitSettings {
    return {
      windowMs: 900000, // 15 minutes
      maxRequests: 100,
      enabled: true,
    };
  }
} 