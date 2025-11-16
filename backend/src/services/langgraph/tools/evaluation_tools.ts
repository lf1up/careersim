import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { transformersService } from '@/services/transformers';

// Lazy imports to avoid TypeORM initialization during module load
let AppDataSource: any;
let SessionMessage: any;
let MessageType: any;
let Simulation: any;

/**
 * Lazy-load database dependencies
 */
function loadDatabaseDependencies() {
  if (!AppDataSource) {
    AppDataSource = require('@/config/database').AppDataSource;
    const SessionMessageModule = require('@/entities/SessionMessage');
    SessionMessage = SessionMessageModule.SessionMessage;
    MessageType = SessionMessageModule.MessageType;
    Simulation = require('@/entities/Simulation').Simulation;
  }
}

// Define schemas separately to avoid type inference issues
const analyzeUserBehaviorSchema = z.object({
  userMessage: z.string().describe('The user message to analyze'),
  keyBehaviors: z.array(z.string()).describe('List of key behaviors to check for'),
});

type AnalyzeUserBehaviorParams = z.infer<typeof analyzeUserBehaviorSchema>;

const analyzeAiIndicatorsSchema = z.object({
  aiMessage: z.string().describe('The AI message to analyze'),
  successIndicators: z.array(z.string()).describe('List of success indicators to check for'),
});

type AnalyzeAiIndicatorsParams = z.infer<typeof analyzeAiIndicatorsSchema>;

const getGoalContextSchema = z.object({
  sessionId: z.string().describe('The session ID'),
});

type GetGoalContextParams = z.infer<typeof getGoalContextSchema>;

const getConversationWindowSchema = z.object({
  sessionId: z.string().describe('The session ID'),
  maxMessages: z.number().default(8).describe('Maximum number of recent messages to retrieve'),
});

type GetConversationWindowParams = z.infer<typeof getConversationWindowSchema>;

/**
 * Tool: Analyze User Behavior
 * Scores a user message against key behaviors using zero-shot classification
 */
export const analyzeUserBehaviorTool = new DynamicStructuredTool({
  name: 'analyze_user_behavior',
  description: 'Analyze a user message to determine if it demonstrates specific key behaviors. Returns a confidence score (0-1) indicating how well the message aligns with the target behaviors.',
  schema: analyzeUserBehaviorSchema,
  func: async ({ userMessage, keyBehaviors }: AnalyzeUserBehaviorParams): Promise<string> => {
    try {
      if (!keyBehaviors || keyBehaviors.length === 0) {
        return JSON.stringify({ score: 0, message: 'No key behaviors provided' });
      }

      // Use transformers service to classify
      const result = await transformersService.classifySequence(userMessage, keyBehaviors);
      
      return JSON.stringify({
        score: result.confidence,
        matchedBehavior: result.label,
        confidence: result.confidence,
      });
    } catch (error) {
      console.error('Error in analyzeUserBehaviorTool:', error);
      return JSON.stringify({ score: 0, error: 'Analysis failed' });
    }
  },
} as any);

/**
 * Tool: Analyze AI Response Indicators
 * Scores an AI response against success indicators
 */
export const analyzeAiIndicatorsTool = new DynamicStructuredTool({
  name: 'analyze_ai_indicators',
  description: 'Analyze an AI response to check if it meets success indicators. Returns a confidence score (0-1) indicating how well the response demonstrates the indicators.',
  schema: analyzeAiIndicatorsSchema,
  func: async ({ aiMessage, successIndicators }: AnalyzeAiIndicatorsParams): Promise<string> => {
    try {
      if (!successIndicators || successIndicators.length === 0) {
        return JSON.stringify({ score: 1.0, message: 'No success indicators to check' });
      }

      // Use transformers service
      const result = await transformersService.classifySequence(aiMessage, successIndicators);
      
      // Also get sentiment/emotion as bonus signals
      const [emotion, sentiment] = await Promise.all([
        transformersService.analyzeEmotion(aiMessage).catch(() => null),
        transformersService.analyzeSentiment(aiMessage).catch(() => null),
      ]);

      // Boost score if positive sentiment/emotion
      let adjustedScore = result.confidence;
      if (sentiment && sentiment.sentiment === 'positive') {
        adjustedScore = Math.min(1.0, adjustedScore + 0.1);
      }
      if (emotion && ['friendly', 'encouraging', 'neutral'].includes(emotion.emotion)) {
        adjustedScore = Math.min(1.0, adjustedScore + 0.05);
      }

      return JSON.stringify({
        score: adjustedScore,
        matchedIndicator: result.label,
        confidence: result.confidence,
        emotion: emotion?.emotion,
        sentiment: sentiment?.sentiment,
      });
    } catch (error) {
      console.error('Error in analyzeAiIndicatorsTool:', error);
      return JSON.stringify({ score: 0.5, error: 'Analysis failed' });
    }
  },
} as any);

/**
 * Tool: Get Goal Context
 * Retrieves goal definitions and current progress
 */
export const getGoalContextTool = new DynamicStructuredTool({
  name: 'get_goal_context',
  description: 'Retrieve the conversation goals, their definitions, and current progress status. Use this to understand what goals need to be evaluated.',
  schema: getGoalContextSchema,
  func: async ({ sessionId }: GetGoalContextParams): Promise<string> => {
    try {
      // This will be populated from the graph state
      // For now, return a placeholder that indicates to check state
      return JSON.stringify({
        message: 'Goal context should be retrieved from graph state',
        sessionId,
      });
    } catch (error) {
      console.error('Error in getGoalContextTool:', error);
      return JSON.stringify({ error: 'Failed to retrieve goal context' });
    }
  },
} as any);

/**
 * Tool: Get Conversation Window
 * Retrieves recent messages for context
 */
export const getConversationWindowTool = new DynamicStructuredTool({
  name: 'get_conversation_window',
  description: 'Retrieve recent conversation messages (last N messages) for context. Useful for understanding the conversation flow.',
  schema: getConversationWindowSchema,
  func: async ({ sessionId, maxMessages = 8 }: GetConversationWindowParams): Promise<string> => {
    try {
      // Load database dependencies
      loadDatabaseDependencies();
      
      const messageRepo = AppDataSource.getRepository(SessionMessage);
      const messages = await messageRepo
        .createQueryBuilder('message')
        .where('message.sessionId = :sessionId', { sessionId })
        .orderBy('message.sequenceNumber', 'DESC')
        .limit(maxMessages)
        .getMany();

      const formatted = messages.reverse().map(m => ({
        role: m.type === MessageType.USER ? 'user' : 'ai',
        content: m.content,
        sequenceNumber: m.sequenceNumber,
        timestamp: m.timestamp,
      }));

      return JSON.stringify({ messages: formatted });
    } catch (error) {
      console.error('Error in getConversationWindowTool:', error);
      return JSON.stringify({ error: 'Failed to retrieve messages', messages: [] });
    }
  },
} as any);

/**
 * All evaluation tools as an array
 */
export const evaluationTools = [
  analyzeUserBehaviorTool,
  analyzeAiIndicatorsTool,
  getGoalContextTool,
  getConversationWindowTool,
];

/**
 * Helper: Execute behavior analysis tool with state context
 */
export async function executeUserBehaviorAnalysis(
  userMessage: string,
  keyBehaviors: string[],
): Promise<{ score: number; matchedBehavior?: string; confidence?: number }> {
  const result = await analyzeUserBehaviorTool.invoke({
    userMessage,
    keyBehaviors,
  });
  
  try {
    return JSON.parse(result);
  } catch {
    return { score: 0 };
  }
}

/**
 * Helper: Execute AI indicators analysis with state context
 */
export async function executeAiIndicatorsAnalysis(
  aiMessage: string,
  successIndicators: string[],
): Promise<{ score: number; matchedIndicator?: string; confidence?: number }> {
  const result = await analyzeAiIndicatorsTool.invoke({
    aiMessage,
    successIndicators,
  });
  
  try {
    return JSON.parse(result);
  } catch {
    return { score: 0.5 };
  }
}

