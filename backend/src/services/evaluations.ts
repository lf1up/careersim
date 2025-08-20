import { transformersService } from '@/services/transformers';
import { Simulation } from '@/entities/Simulation';
import { SessionMessage, MessageType } from '@/entities/SessionMessage';
import { SimulationSession } from '@/entities/SimulationSession';
import { AppDataSource } from '@/config/database';

export interface GoalEvaluationResult {
  updatedProgress: SimulationSession['goalProgress'];
  allRequiredAchieved: boolean;
}

// TODO: OPTIMIZE THIS SERVICE TO AVOID DRAMATIC SLOWDOWN DUE TO EXTERNAL NLP SERVICE CALLS
export class EvaluationsService {
  // Thresholds can later be moved to config
  private static readonly STEP_DETECTION_THRESHOLD = 0.6;
  private static readonly BEHAVIOR_THRESHOLD = 0.6;
  private static readonly SUCCESS_THRESHOLD = 0.6;

  // In test mode we relax thresholds to improve determinism against non-deterministic external models
  private isTestMode(): boolean {
    return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
  }

  private getStepDetectionThreshold(): number {
    return this.isTestMode() ? 0.6 : EvaluationsService.STEP_DETECTION_THRESHOLD;
  }

  private getBehaviorThreshold(): number {
    return this.isTestMode() ? 0.6 : EvaluationsService.BEHAVIOR_THRESHOLD;
  }

  private getSuccessThreshold(): number {
    return this.isTestMode() ? 0.6 : EvaluationsService.SUCCESS_THRESHOLD;
  }

  // Transformers-based evaluation of the latest messages in conversation (might be broken, needs to be adjusted)
  public async evaluateAfterTurn(
    simulation: Simulation,
    session: SimulationSession,
    lastUserMessage: SessionMessage,
    lastAiMessage?: SessionMessage,
  ): Promise<GoalEvaluationResult> {
    const goals = (simulation.conversationGoals || []).slice().sort((a, b) => a.goalNumber - b.goalNumber);
    const progress = (session.goalProgress || this.initializeProgress(goals)).map((p) => ({ ...p }));

    if (goals.length === 0) {
      return { updatedProgress: progress, allRequiredAchieved: true };
    }

    // Optimization: determine if a required step is pending first (no external calls)
    const unachievedRequired = goals
      .filter((g) => !g.isOptional)
      .sort((a, b) => a.goalNumber - b.goalNumber)
      .find((g) => !(progress.find((p) => p.goalNumber === g.goalNumber)?.status === 'achieved'));

    let activeStep = unachievedRequired || null;

    // Only call external classifier to detect an optional candidate when no required step is pending
    if (!activeStep) {
      const candidateStep = await this.detectCandidateStep(lastUserMessage.content, goals);
      activeStep = this.selectActiveStep(candidateStep, goals, progress);
    }
    if (!activeStep) {
      return { updatedProgress: progress, allRequiredAchieved: this.requiredAchieved(progress, goals) };
    }

    // mark started
    const target = progress.find((p) => p.goalNumber === activeStep.goalNumber)!;
    if (target.status === 'not_started') {
      target.status = 'in_progress';
      target.startedAt = new Date().toISOString();
    }

    // Run external calls in parallel where possible
    const behaviorPromise = this.scoreAgainstLabels(
      lastUserMessage.content,
      activeStep.keyBehaviors || [],
    );

    // Success indicators using AI reply + emotion/sentiment
    let successScore = 0;
    let behaviorScore = NaN as number;
    if (lastAiMessage) {
      const indicatorPromise = this.scoreAgainstLabels(
        lastAiMessage.content,
        activeStep.successIndicators || [],
      );

      // Use cached metadata if available; otherwise, analyze both in parallel
      const hasCachedEmotion = !!lastAiMessage.metadata?.emotionAnalysis;
      const hasCachedSentiment = !!lastAiMessage.metadata?.sentimentAnalysis;

      const emotionPromise = hasCachedEmotion
        ? Promise.resolve(lastAiMessage.metadata!.emotionAnalysis)
        : transformersService.analyzeEmotion(lastAiMessage.content);
      const sentimentPromise = hasCachedSentiment
        ? Promise.resolve(lastAiMessage.metadata!.sentimentAnalysis)
        : transformersService.analyzeSentiment(lastAiMessage.content);

      const [bScore, indicatorScore, emotion, sentiment] = await Promise.all([
        behaviorPromise,
        indicatorPromise,
        emotionPromise,
        sentimentPromise,
      ]);

      behaviorScore = bScore;

      const toneBoost = (['friendly', 'encouraging', 'neutral'].includes(emotion.emotion) && sentiment.sentiment !== 'negative') ? 0.1 : 0;
      successScore = Math.max(0, Math.min(1, (Number.isNaN(indicatorScore) ? 0 : indicatorScore) + toneBoost));

      if (!Number.isNaN(behaviorScore)) {
        target.confidence = Math.max(target.confidence || 0, behaviorScore);
        if (!target.evidence) target.evidence = [];
        target.evidence.push({
          messageId: lastUserMessage.id,
          role: 'user',
          label: 'behavior',
          score: behaviorScore,
        });
      }

      if (!target.evidence) target.evidence = [];
      target.evidence.push({
        messageId: lastAiMessage.id,
        role: 'ai',
        label: 'success',
        score: successScore,
      });
    } else {
      // No AI message; only await behavior
      behaviorScore = await behaviorPromise;
      if (!Number.isNaN(behaviorScore)) {
        target.confidence = Math.max(target.confidence || 0, behaviorScore);
        if (!target.evidence) target.evidence = [];
        target.evidence.push({
          messageId: lastUserMessage.id,
          role: 'user',
          label: 'behavior',
          score: behaviorScore,
        });
      }
    }

    const behaviorOk = (target.confidence || 0) >= this.getBehaviorThreshold() || (behaviorScore || 0) >= this.getBehaviorThreshold();
    const successOk = (activeStep.successIndicators && activeStep.successIndicators.length > 0)
      ? successScore >= this.getSuccessThreshold()
      : true;

    if (behaviorOk && successOk && target.status !== 'achieved') {
      target.status = 'achieved';
      target.achievedAt = new Date().toISOString();
    }

    return {
      updatedProgress: progress,
      allRequiredAchieved: this.requiredAchieved(progress, goals),
    };
  }

  // AI-driven version using LLM to evaluate achieved goals given the latest exchange
  public async evaluateAfterTurnLLM(
    simulation: Simulation,
    session: SimulationSession,
    lastUserMessage: SessionMessage,
    lastAiMessage?: SessionMessage,
  ): Promise<GoalEvaluationResult> {
    const goals = (simulation.conversationGoals || []).slice().sort((a, b) => a.goalNumber - b.goalNumber);
    const progress = (session.goalProgress || this.initializeProgress(goals)).map((p) => ({ ...p }));

    if (goals.length === 0) {
      return { updatedProgress: progress, allRequiredAchieved: true };
    }

    // Dynamically import to avoid potential circular deps
    const { AIService } = await import('@/services/ai');
    const ai = new AIService();

    // Provide a compact but realistic window: from the last user message through the latest AI messages
    // This supports AI bursts (multiple AI replies after a single user input)
    const messageRepository = AppDataSource.getRepository(SessionMessage);
    const fullHistory = await messageRepository
      .createQueryBuilder('message')
      .where('message.sessionId = :sessionId', { sessionId: session.id })
      .orderBy('message.sequenceNumber', 'ASC')
      .getMany();

    // Find the slice that starts at the last user message
    const startIdx = fullHistory.findIndex((m) => m.id === lastUserMessage.id) ?? -1;
    const windowMessages = startIdx >= 0 ? fullHistory.slice(startIdx) : [lastUserMessage, ...(lastAiMessage ? [lastAiMessage] : [])];
    // Optionally cap the window length to avoid token bloat (keep last ~8 messages)
    const recentMessages = windowMessages.slice(-8);

    const aiResult = await ai.evaluateGoalsWithLLM({
      simulation,
      session,
      goals,
      lastUserMessage,
      lastAiMessage,
      recentMessages,
    });

    // Merge AI-evaluated steps into progress
    const evalByStep = new Map<number, (typeof aiResult)['steps'][number]>();
    for (const step of aiResult.steps) evalByStep.set(step.stepNumber, step);

    for (const target of progress) {
      const stepEval = evalByStep.get(target.goalNumber);
      if (!stepEval) continue;

      // Update confidence and status based on AI evaluation
      const clampedConfidence = Math.max(0, Math.min(1, stepEval.confidence || 0));
      target.confidence = Math.max(target.confidence || 0, clampedConfidence);

      if (stepEval.status === 'in_progress' && target.status === 'not_started') {
        target.status = 'in_progress';
        target.startedAt = new Date().toISOString();
      }

      if (stepEval.status === 'achieved' && target.status !== 'achieved') {
        // Use same thresholds as behavior/success for consistency
        const pass = clampedConfidence >= this.getBehaviorThreshold();
        if (pass) {
          if (target.status === 'not_started') {
            target.startedAt = new Date().toISOString();
          }
          target.status = 'achieved';
          target.achievedAt = new Date().toISOString();
        }
      }

      // Map evidence to the most recent messages in the evaluation window
      if (Array.isArray(stepEval.evidence) && stepEval.evidence.length > 0) {
        if (!target.evidence) target.evidence = [];
        const lastAiInWindow = [...recentMessages].reverse().find((m) => m.type === MessageType.AI);
        for (const e of stepEval.evidence) {
          const messageId = e.role === 'user' ? lastUserMessage?.id : (lastAiInWindow?.id || lastAiMessage?.id);
          if (!messageId) continue;
          target.evidence.push({
            messageId,
            role: e.role,
            label: 'llm_evidence',
            score: clampedConfidence,
          });
        }
      }
    }

    return {
      updatedProgress: progress,
      allRequiredAchieved: this.requiredAchieved(progress, goals),
    };
  }

  private initializeProgress(goals: NonNullable<Simulation['conversationGoals']>): SimulationSession['goalProgress'] {
    return goals.map((g) => ({
      goalNumber: g.goalNumber,
      isOptional: !!g.isOptional,
      title: g.title,
      status: 'not_started',
      confidence: 0,
      evidence: [],
    }));
  }

  private async detectCandidateStep(text: string, goals: NonNullable<Simulation['conversationGoals']>) {
    const labels = goals.map((g) => g.title);
    if (labels.length === 0) return null;
    const result = await transformersService.classifySequence(text, labels);
    if (result.confidence >= this.getStepDetectionThreshold()) {
      const matched = goals.find((g) => g.title === result.label);
      return matched || null;
    }
    return null;
  }

  private selectActiveStep(candidate: any, goals: NonNullable<Simulation['conversationGoals']>, progress: NonNullable<SimulationSession['goalProgress']>) {
    // Required steps must be completed in order; optional can be matched anytime
    const unachievedRequired = goals
      .filter((g) => !g.isOptional)
      .sort((a, b) => a.goalNumber - b.goalNumber)
      .find((g) => !(progress.find((p) => p.goalNumber === g.goalNumber)?.status === 'achieved'));

    if (unachievedRequired) {
      return unachievedRequired; // enforce order for required steps
    }

    // Helper to check achieved status
    const isAchieved = (g: any) => progress.find((p) => p.goalNumber === g.goalNumber)?.status === 'achieved';

    // Otherwise allow optional candidate if detected and not already achieved
    if (candidate && candidate.isOptional && !isAchieved(candidate)) return candidate;

    // If candidate is missing or already achieved, pick the next unachieved optional in step order
    const nextOptional = goals
      .filter((g) => !!g.isOptional)
      .sort((a, b) => a.goalNumber - b.goalNumber)
      .find((g) => !isAchieved(g));
    if (nextOptional) return nextOptional;

    return null;
  }

  private async scoreAgainstLabels(text: string, labels: string[]): Promise<number> {
    if (!labels || labels.length === 0) return NaN;
    const result = await transformersService.classifySequence(text, labels);
    return result.confidence;
  }

  private requiredAchieved(progress: NonNullable<SimulationSession['goalProgress']>, goals: NonNullable<Simulation['conversationGoals']>): boolean {
    const required = goals.filter((g) => !g.isOptional);
    if (required.length === 0) return true;
    return required.every((g) => progress.find((p) => p.goalNumber === g.goalNumber)?.status === 'achieved');
  }
}

export const evaluationsService = new EvaluationsService();



// Compute and persist aggregate session scores when a session is completed.
// This provides the per-skill `scores` (0..1) and `overallScore` (0..100) expected by analytics.
export async function computeAndPersistSessionScores(sessionId: string): Promise<SimulationSession | null> {
  const sessionRepository = AppDataSource.getRepository(SimulationSession);
  const messageRepository = AppDataSource.getRepository(SessionMessage);

  const session = await sessionRepository.findOne({
    where: { id: sessionId },
    relations: ['simulation'],
  });
  if (!session) return null;

  // Gather AI messages for lightweight aggregation
  const messages = await messageRepository.find({
    where: { session: { id: sessionId } as any },
    order: { sequenceNumber: 'ASC' as any },
  });
  const aiMessages = messages.filter((m) => m.type === MessageType.AI);

  // Required-achieved ratio from goal progress
  const goals = session.simulation?.conversationGoals || [];
  const progress = session.goalProgress || [];
  const requiredGoals = goals.filter((g) => !g.isOptional);
  const requiredCount = requiredGoals.length;
  const achievedRequiredCount = requiredGoals.filter((g) =>
    progress.find((p) => (p as any).goalNumber === (g as any).goalNumber)?.status === 'achieved',
  ).length;
  const requiredAchievedRatio = requiredCount > 0 ? achievedRequiredCount / requiredCount : 0;

  // Coherence proxy for communication from AI quality scores when present
  let coherenceAvg = 0;
  let coherenceCount = 0;
  for (const m of aiMessages) {
    const c = (m.metadata as any)?.qualityScores?.coherence;
    if (typeof c === 'number' && !Number.isNaN(c)) {
      coherenceAvg += c;
      coherenceCount += 1;
    }
  }
  const communicationScore = coherenceCount > 0 ? Math.max(0, Math.min(1, coherenceAvg / coherenceCount)) : requiredAchievedRatio || 0.6;

  // Emotional score from AI sentiment analysis when present
  let positive = 0;
  let totalSent = 0;
  for (const m of aiMessages) {
    const sent = (m.metadata as any)?.sentimentAnalysis?.sentiment || (m.metadata as any)?.sentiment;
    if (sent === 'positive' || sent === 'neutral' || sent === 'negative') {
      totalSent += 1;
      if (sent === 'positive') positive += 1;
    }
  }
  const emotionalScore = totalSent > 0 ? positive / totalSent : 0.5;

  // Problem solving and outcome: use goal completion as a baseline
  const problemSolvingScore = requiredAchievedRatio;
  const outcomeScore = requiredAchievedRatio;

  session.scores = {
    communication: Number(Math.max(0, Math.min(1, communicationScore)).toFixed(3)),
    problemSolving: Number(Math.max(0, Math.min(1, problemSolvingScore)).toFixed(3)),
    emotional: Number(Math.max(0, Math.min(1, emotionalScore)).toFixed(3)),
    outcome: Number(Math.max(0, Math.min(1, outcomeScore)).toFixed(3)),
  };

  // Overall is a weighted sum (0..1) scaled to 0..100
  const overall01 = session.calculateOverallScore();
  session.overallScore = Number((overall01 * 100).toFixed(2));

  await sessionRepository.save(session);
  return session;
}

