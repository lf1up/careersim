import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ConversationGraphState, GoalProgressItem } from '../state';
import { config } from '@/config/env';
import { evaluationTools, executeUserBehaviorAnalysis, executeAiIndicatorsAnalysis } from '../tools/evaluation_tools';
import { emitGoalProgressUpdate } from '@/services/realtime';

// Lazy imports to avoid TypeORM initialization during module load
let AppDataSource: any;
let SimulationSession: any;

/**
 * Lazy-load database dependencies
 */
function loadDatabaseDependencies() {
  if (!AppDataSource) {
    AppDataSource = require('@/config/database').AppDataSource;
    SimulationSession = require('@/entities/SimulationSession').SimulationSession;
  }
}

/**
 * Node: Evaluate Goals
 * Uses an agent with tools to evaluate conversation goals
 */
export async function evaluateGoalsNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  console.log(`🎯 Evaluating goals for session ${state.sessionId}`);

  // Skip if evaluation not needed
  if (!state.needsEvaluation) {
    return { evaluationComplete: true };
  }

  // Skip if no goals defined
  if (!state.simulation?.conversationGoals || state.simulation.conversationGoals.length === 0) {
    return { evaluationComplete: true };
  }

  try {
    const goals = state.simulation.conversationGoals.sort((a: any, b: any) => a.goalNumber - b.goalNumber);
    const progress = state.goalProgress || [];

    // Initialize progress if needed
    if (progress.length === 0) {
      const initialized = goals.map((g: any) => ({
        goalNumber: g.goalNumber,
        isOptional: !!g.isOptional,
        title: g.title,
        status: 'not_started' as const,
        confidence: 0,
        evidence: [],
      }));
      
      return {
        goalProgress: initialized,
        evaluationComplete: true,
        needsEvaluation: false,
      };
    }

    // Determine active goal (first unachieved required goal, or any optional)
    const unachievedRequired = goals
      .filter((g: any) => !g.isOptional)
      .find((g: any) => {
        const p = progress.find(p => p.goalNumber === g.goalNumber);
        return !p || p.status !== 'achieved';
      });

    const activeGoal = unachievedRequired || goals.find((g: any) => {
      const p = progress.find(p => p.goalNumber === g.goalNumber);
      return p && p.status !== 'achieved';
    });

    if (!activeGoal) {
      // All goals achieved
      return {
        evaluationComplete: true,
        needsEvaluation: false,
      };
    }

    // Find target progress entry
    const targetProgress = progress.find(p => p.goalNumber === (activeGoal as any).goalNumber);
    if (!targetProgress) {
      return { evaluationComplete: true };
    }

    // Mark as in progress if not started
    if (targetProgress.status === 'not_started') {
      targetProgress.status = 'in_progress';
      targetProgress.startedAt = new Date().toISOString();
    }

    // Analyze user behavior if we have a last user message
    let behaviorScore = 0;
    if (state.lastUserMessage && (activeGoal as any).keyBehaviors?.length > 0) {
      const behaviorResult = await executeUserBehaviorAnalysis(
        state.lastUserMessage,
        (activeGoal as any).keyBehaviors,
      );
      behaviorScore = behaviorResult.score || 0;
      
      if (behaviorScore > 0) {
        targetProgress.confidence = Math.max(targetProgress.confidence || 0, behaviorScore);
        if (!targetProgress.evidence) targetProgress.evidence = [];
        targetProgress.evidence.push({
          messageId: 'user-' + Date.now(), // Would be actual message ID in production
          role: 'user',
          label: 'behavior',
          score: behaviorScore,
        });
      }
    }

    // Analyze AI success indicators if we have a last AI message
    let indicatorScore = 0;
    if (state.lastAiMessage && (activeGoal as any).successIndicators?.length > 0) {
      const indicatorResult = await executeAiIndicatorsAnalysis(
        state.lastAiMessage,
        (activeGoal as any).successIndicators,
      );
      indicatorScore = indicatorResult.score || 0;
      
      if (indicatorScore > 0) {
        if (!targetProgress.evidence) targetProgress.evidence = [];
        targetProgress.evidence.push({
          messageId: 'ai-' + Date.now(), // Would be actual message ID in production
          role: 'ai',
          label: 'success',
          score: indicatorScore,
        });
      }
    }

    // Determine if goal is achieved
    const behaviorThreshold = 0.6;
    const successThreshold = 0.6;
    
    const behaviorMet = behaviorScore >= behaviorThreshold || (targetProgress.confidence || 0) >= behaviorThreshold;
    const successMet = (activeGoal as any).successIndicators?.length === 0 || indicatorScore >= successThreshold;

    if (behaviorMet && successMet && targetProgress.status !== 'achieved') {
      targetProgress.status = 'achieved';
      targetProgress.achievedAt = new Date().toISOString();
      console.log(`✅ Goal ${targetProgress.goalNumber} achieved!`);
    }

    // Load database dependencies
    loadDatabaseDependencies();
    
    // Update session in database
    const sessionRepo = AppDataSource.getRepository(SimulationSession);
    const session = await sessionRepo.findOne({ where: { id: state.sessionId } });
    if (session) {
      session.goalProgress = progress as any;
      await sessionRepo.save(session);

      // Emit progress update via Socket.IO
      try {
        await emitGoalProgressUpdate(session);
      } catch (emitError) {
        console.warn('Failed to emit goal progress:', emitError);
      }
    }

    console.log(`📊 Evaluation complete. Active goal: ${(activeGoal as any).title}, status: ${targetProgress.status}`);

    return {
      goalProgress: progress,
      evaluationComplete: true,
      needsEvaluation: false,
    };
  } catch (error) {
    console.error('Error evaluating goals:', error);
    return {
      evaluationComplete: true,
      needsEvaluation: false,
      lastError: error instanceof Error ? error.message : 'Goal evaluation failed',
    };
  }
}

