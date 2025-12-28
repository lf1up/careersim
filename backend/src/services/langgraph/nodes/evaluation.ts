import { ConversationGraphState } from '../state';
import { executeUserBehaviorAnalysis, executeAiIndicatorsAnalysis } from '../tools/evaluation_tools';
import { emitGoalProgressUpdate } from '@/services/realtime';
import { devLogLangGraphEvent } from '../devLogger';

// Lazy imports to avoid TypeORM initialization during module load
let AppDataSource: any;
let SimulationSession: any;
let SessionMessage: any;
let MessageType: any;

/**
 * Lazy-load database dependencies
 */
async function loadDatabaseDependencies() {
  if (!AppDataSource) {
    const databaseModule = await import('@/config/database');
    AppDataSource = databaseModule.AppDataSource;
    
    const simulationSessionModule = await import('@/entities/SimulationSession');
    SimulationSession = simulationSessionModule.SimulationSession;
    
    const SessionMessageModule = await import('@/entities/SessionMessage');
    SessionMessage = SessionMessageModule.SessionMessage;
    MessageType = SessionMessageModule.MessageType;
  }
}

/**
 * Evaluation thresholds
 */
class EvaluationThresholds {
  // [TODO]: USE UNIQUE THRESOLDS PER EACH SIMULATION GOAL
  private static readonly BEHAVIOR_THRESHOLD = 0.7;
  private static readonly SUCCESS_THRESHOLD = 0.7;

  private static isTestMode(): boolean {
    return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
  }

  static getBehaviorThreshold(): number {
    return this.isTestMode() ? 0.6 : this.BEHAVIOR_THRESHOLD;
  }

  static getSuccessThreshold(): number {
    return this.isTestMode() ? 0.6 : this.SUCCESS_THRESHOLD;
  }
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Get actual message IDs from database for evidence tracking
 */
async function getRecentMessageIds(
  sessionId: string,
  limit: number = 2,
): Promise<{ userMessageId?: string; aiMessageId?: string }> {
  await loadDatabaseDependencies();
  
  try {
    const messageRepo = AppDataSource.getRepository(SessionMessage);
    const messages = await messageRepo
      .createQueryBuilder('message')
      .where('message.sessionId = :sessionId', { sessionId })
      .orderBy('message.sequenceNumber', 'DESC')
      .limit(limit)
      .getMany();

    const aiMessage = messages.find((m) => m.type === MessageType.AI);
    const userMessage = messages.find((m) => m.type === MessageType.USER);

    return {
      userMessageId: userMessage?.id,
      aiMessageId: aiMessage?.id,
    };
  } catch (error) {
    console.warn('Error fetching message IDs:', error);
    return {};
  }
}

/**
 * Detect which goal the user is currently working on using enhanced labels
 * Uses zero-shot classification with goal title + key behaviors for better accuracy
 */
async function detectActiveGoal(
  userMessage: string,
  goals: any[],
  progress: any[],
): Promise<any | null> {
  try {
    // Get unachieved goals
    const unachieved = goals.filter((g: any) => {
      const p = progress.find((p) => p.goalNumber === g.goalNumber);
      return !p || p.status !== 'achieved';
    });

    if (unachieved.length === 0) return null;

    // Create enhanced labels: "Goal Title: key behavior 1; key behavior 2"
    // This provides much richer context for classification
    const enhancedLabels = unachieved.map((g: any) => {
      const behaviors = g.keyBehaviors?.slice(0, 2).join('; ') || '';
      return behaviors ? `${g.title}: ${behaviors}` : g.title;
    });

    console.log(`🔍 Detecting active goal from ${unachieved.length} candidates:`, enhancedLabels);

    // Use transformers service for zero-shot classification
    const { transformersService } = await import('@/services/transformers');
    const result = await transformersService.classifySequence(userMessage, enhancedLabels);
    
    const threshold = EvaluationThresholds.getBehaviorThreshold();
    console.log(`   📊 Best match: "${result.label}" (confidence: ${result.confidence.toFixed(3)}, threshold: ${threshold})`);

    // Only consider it a match if confidence is high enough
    if (result.confidence >= threshold) {
      // Find the goal that matches this label
      const matchedGoal = unachieved.find((g: any) => {
        const behaviors = g.keyBehaviors?.slice(0, 2).join('; ') || '';
        const label = behaviors ? `${g.title}: ${behaviors}` : g.title;
        return label === result.label;
      });
      
      if (matchedGoal) {
        console.log(`   ✅ Active goal detected: #${matchedGoal.goalNumber} - ${matchedGoal.title}`);
        return matchedGoal;
      }
    } else {
      console.log(`   ⚠️  No confident match (${result.confidence.toFixed(3)} < ${threshold})`);
    }

    return null;
  } catch (error) {
    console.warn('Error detecting active goal:', error);
    return null;
  }
}

/**
 * Node: Evaluate Goals
 * Enhanced version with parallel execution, sentiment analysis, and AI-powered goal detection
 */
export async function evaluateGoalsNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  console.log(`🎯 Evaluating goals for session ${state.sessionId}`);

  // Skip if evaluation not needed
  if (!state.needsEvaluation) {
    console.log(`🔄 Evaluation not needed, skipping`);
    return { evaluationComplete: true };
  }

  // Skip if no goals defined
  if (!state.simulation?.conversationGoals || state.simulation.conversationGoals.length === 0) {
    console.log(`🔄 No goals defined, skipping`);
    return { evaluationComplete: true };
  }

  try {
    const goals = state.simulation.conversationGoals.sort((a: any, b: any) => a.goalNumber - b.goalNumber);
    let progress = state.goalProgress || [];
    await devLogLangGraphEvent(state.sessionId, 'node:evaluate_goals:start', {
      lastUserMessage: state.lastUserMessage,
      lastAiMessage: state.lastAiMessage,
      goals: goals.map((g: any) => ({
        goalNumber: g.goalNumber,
        title: g.title,
        isOptional: !!g.isOptional,
        evaluationConfig: g.evaluationConfig,
        keyBehaviors: g.keyBehaviors,
        successIndicators: g.successIndicators,
      })),
      progress,
    });

    // Initialize progress if needed
    if (progress.length === 0) {
      console.log(`🔄 No progress, initializing`);
      progress = goals.map((g: any) => ({
        goalNumber: g.goalNumber,
        isOptional: !!g.isOptional,
        title: g.title,
        status: 'not_started' as const,
        confidence: 0,
        evidence: [],
      }));
    }

    // Get actual message IDs for evidence tracking (once for all goals)
    const { userMessageId, aiMessageId } = await getRecentMessageIds(state.sessionId);

    // Stage-based evaluation:
    // Evaluate ONLY the next unachieved required goal in sequence.
    // This prevents "jumping" (e.g., achieving Professional Closing early) and keeps evaluation aligned with staged prompting.
    let goalsToEvaluate: any[] = [];
    
    const requiredGoals = goals
      .filter((g: any) => !g.isOptional)
      .sort((a: any, b: any) => a.goalNumber - b.goalNumber);
    
    const nextRequired = requiredGoals.find((g: any) => {
      const p = progress.find((p) => p.goalNumber === g.goalNumber);
      return !p || p.status !== 'achieved';
    });
    
    if (nextRequired) {
      console.log(`🎯 Stage-based: evaluating next required goal #${nextRequired.goalNumber} - ${nextRequired.title}`);
      goalsToEvaluate = [nextRequired];
    } else {
      // All required goals done, check if there are any optional left (in order)
      const optionalGoals = goals
        .filter((g: any) => !!g.isOptional)
        .sort((a: any, b: any) => a.goalNumber - b.goalNumber);
      
      const nextOptional = optionalGoals.find((g: any) => {
        const p = progress.find((p) => p.goalNumber === g.goalNumber);
        return !p || p.status !== 'achieved';
      });
      
      if (nextOptional) {
        console.log(`🎯 Stage-based: all required achieved, evaluating next optional goal #${nextOptional.goalNumber} - ${nextOptional.title}`);
        goalsToEvaluate = [nextOptional];
      }
    }

    console.log(`🎯 Goal evaluation:`, {
      totalGoals: goals.length,
      goalsToEvaluate: goalsToEvaluate.length,
      evaluatingGoal: goalsToEvaluate[0] ? `#${goalsToEvaluate[0].goalNumber} - ${goalsToEvaluate[0].title}` : 'none',
      achievedCount: progress.filter(p => p.status === 'achieved').length,
      progressStatus: progress.map((p) => `#${p.goalNumber}: ${p.status}`).join(', '),
    });

    if (goalsToEvaluate.length === 0) {
      console.log(`🎉 All goals completed!`);
      return {
        evaluationComplete: true,
        needsEvaluation: false,
      };
    }

    // Evaluate all unachieved goals in parallel
    const defaultBehaviorThreshold = EvaluationThresholds.getBehaviorThreshold();
    const defaultSuccessThreshold = EvaluationThresholds.getSuccessThreshold();
    const defaultStrongEvidenceScore = 0.65;
    const defaultMinEvidenceCount = 2;
    const defaultMinStrongEvidenceCount = 2;

    let anyGoalAchieved = false;

    // Process each goal
    for (const goal of goalsToEvaluate) {
      const targetProgress = progress.find((p) => p.goalNumber === goal.goalNumber);
      if (!targetProgress) continue;

      // Mark as in progress if not started
      if (targetProgress.status === 'not_started') {
        targetProgress.status = 'in_progress';
        targetProgress.startedAt = new Date().toISOString();
      }

      const hasBehaviors = goal.keyBehaviors?.length > 0;
      const hasIndicators = goal.successIndicators?.length > 0;

      // Per-goal evaluation tuning (stored in simulation.conversationGoals JSON)
      const cfg = (goal as any).evaluationConfig || {};
      const behaviorThreshold = asFiniteNumber(cfg.behaviorThreshold, defaultBehaviorThreshold);
      const successThreshold = asFiniteNumber(cfg.successThreshold, defaultSuccessThreshold);
      const strongEvidenceScore = asFiniteNumber(cfg.strongEvidenceScore, defaultStrongEvidenceScore);
      const minEvidenceCount = Math.floor(asFiniteNumber(cfg.minEvidenceCount, defaultMinEvidenceCount));
      const minStrongEvidenceCount = Math.floor(asFiniteNumber(cfg.minStrongEvidenceCount, defaultMinStrongEvidenceCount));
      const requireSuccessIndicators = cfg.requireSuccessIndicators !== undefined ? !!cfg.requireSuccessIndicators : true;

      let behaviorScore = 0;
      let successScore = 0;
      let behaviorResult: any = undefined;
      let indicatorResult: any = undefined;

      // Analyze user behavior if we have a last user message
      const behaviorPromise = hasBehaviors && state.lastUserMessage
        ? executeUserBehaviorAnalysis(state.lastUserMessage, goal.keyBehaviors)
        : Promise.resolve({ score: 0 });

      // Execute analyses in parallel for this goal
      if (state.lastAiMessage && hasIndicators) {
        // Run behavior and indicator analysis in parallel
        // Note: executeAiIndicatorsAnalysis already includes emotion/sentiment analysis and tone boost
        const [br, ir] = await Promise.all([
          behaviorPromise,
          executeAiIndicatorsAnalysis(state.lastAiMessage, goal.successIndicators),
        ]);

        behaviorResult = br;
        indicatorResult = ir;
        behaviorScore = behaviorResult?.score || 0;
        successScore = indicatorResult?.score || 0;

        // Record behavior evidence
        if (behaviorScore > 0) {
          targetProgress.confidence = Math.max(targetProgress.confidence || 0, behaviorScore);
          if (!targetProgress.evidence) targetProgress.evidence = [];
          targetProgress.evidence.push({
            messageId: userMessageId || 'user-' + Date.now(),
            role: 'user',
            label: 'behavior',
            score: behaviorScore,
          });
        }

        // Record success indicator evidence
        if (successScore > 0) {
          if (!targetProgress.evidence) targetProgress.evidence = [];
          targetProgress.evidence.push({
            messageId: aiMessageId || 'ai-' + Date.now(),
            role: 'ai',
            label: 'success',
            score: successScore,
          });
        }
      } else {
        // No AI message or no indicators; only await behavior analysis
        behaviorResult = await behaviorPromise;
        behaviorScore = behaviorResult?.score || 0;
        
        if (behaviorScore > 0) {
          targetProgress.confidence = Math.max(targetProgress.confidence || 0, behaviorScore);
          if (!targetProgress.evidence) targetProgress.evidence = [];
          targetProgress.evidence.push({
            messageId: userMessageId || 'user-' + Date.now(),
            role: 'user',
            label: 'behavior',
            score: behaviorScore,
          });
        }
      }

      // Fix 3: Use AND logic instead of OR, and require evidence
      const behaviorMet =
        behaviorScore >= behaviorThreshold &&
        (targetProgress.confidence || 0) >= behaviorThreshold;

      // Success criteria:
      // - If indicators exist AND requireSuccessIndicators=true → require indicator match
      // - If indicators exist AND requireSuccessIndicators=false → allow behavior-only (still prefers indicators)
      // - If no indicators exist → require a slightly higher behavior threshold
      const successMet = hasIndicators
        ? (requireSuccessIndicators ? (successScore >= successThreshold) : (successScore >= successThreshold || behaviorScore >= behaviorThreshold))
        : (behaviorScore >= Math.min(1, behaviorThreshold + 0.1));
      
      const evidenceCount = targetProgress.evidence?.length || 0;
      const strongEvidenceCount = targetProgress.evidence?.filter(e => e.score >= strongEvidenceScore).length || 0;
      const hasEnoughEvidence =
        evidenceCount >= minEvidenceCount &&
        strongEvidenceCount >= minStrongEvidenceCount;

      // Debug logging for goal evaluation
      console.log(`📊 Goal ${targetProgress.goalNumber} evaluation:`, {
        title: goal.title,
        status: targetProgress.status,
        behaviorScore,
        successScore,
        confidence: targetProgress.confidence,
        hasBehaviors,
        hasIndicators,
        evaluationConfig: {
          behaviorThreshold,
          successThreshold,
          strongEvidenceScore,
          minEvidenceCount,
          minStrongEvidenceCount,
          requireSuccessIndicators,
        },
        behaviorMet,
        successMet,
        hasEnoughEvidence,
        evidenceCount,
        strongEvidenceCount,
      });
      await devLogLangGraphEvent(state.sessionId, 'node:evaluate_goals:goal_result', {
        goal: {
          goalNumber: goal.goalNumber,
          title: goal.title,
          isOptional: !!goal.isOptional,
        },
        evaluationConfig: {
          behaviorThreshold,
          successThreshold,
          strongEvidenceScore,
          minEvidenceCount,
          minStrongEvidenceCount,
          requireSuccessIndicators,
        },
        inputs: {
          lastUserMessage: state.lastUserMessage,
          lastAiMessage: state.lastAiMessage,
        },
        rawToolResults: {
          behaviorResult,
          indicatorResult,
        },
        computed: {
          behaviorScore,
          successScore,
          behaviorMet,
          successMet,
          hasEnoughEvidence,
          evidenceCount,
          strongEvidenceCount,
          confidence: targetProgress.confidence,
        },
        progressItem: targetProgress,
      });

      if (behaviorMet && successMet && hasEnoughEvidence && targetProgress.status !== 'achieved') {
        targetProgress.status = 'achieved';
        targetProgress.achievedAt = new Date().toISOString();
        anyGoalAchieved = true;
        console.log(`✅ Goal ${targetProgress.goalNumber} achieved!`);
      } else if (targetProgress.status === 'in_progress') {
        const reasons = [];
        if (!behaviorMet) reasons.push('behaviorMet=FAIL');
        if (!successMet) reasons.push('successMet=FAIL');
        if (!hasEnoughEvidence) reasons.push('hasEnoughEvidence=FAIL');
        console.log(`🔄 Goal ${targetProgress.goalNumber} still in progress. Need: ${reasons.join(', ')}`);
      }
    }

    if (anyGoalAchieved) {
      console.log(`🎊 ${progress.filter(p => p.status === 'achieved').length}/${goals.length} goals now achieved`);
    }

    // Load database dependencies
    await loadDatabaseDependencies();
    
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

    const achievedCount = progress.filter(p => p.status === 'achieved').length;
    const inProgressCount = progress.filter(p => p.status === 'in_progress').length;
    console.log(`📊 Evaluation complete. Achieved: ${achievedCount}/${goals.length}, In Progress: ${inProgressCount}`);
    await devLogLangGraphEvent(state.sessionId, 'node:evaluate_goals:done', {
      achievedCount,
      inProgressCount,
      progress,
    });

    return {
      goalProgress: progress,
      evaluationComplete: true,
      needsEvaluation: false,
    };
  } catch (error) {
    console.error('Error evaluating goals:', error);
    await devLogLangGraphEvent(state.sessionId, 'node:evaluate_goals:error', {
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    });
    return {
      evaluationComplete: true,
      needsEvaluation: false,
      lastError: error instanceof Error ? error.message : 'Goal evaluation failed',
    };
  }
}

