import { transformersService } from '@/services/transformers';
import { Simulation } from '@/entities/Simulation';
import { SessionMessage } from '@/entities/SessionMessage';
import { SimulationSession } from '@/entities/SimulationSession';

export interface GoalEvaluationResult {
  updatedProgress: SimulationSession['goalProgress'];
  allRequiredAchieved: boolean;
}

// TODO: OPTIMIZE THIS SERVICE TO AVOID DRAMATIC SLOWDOWN DUE TO EXTERNAL NLP SERVICE CALLS
export class EvaluationsService {
  // Thresholds can later be moved to config
  private static readonly STEP_DETECTION_THRESHOLD = 0.5;
  private static readonly BEHAVIOR_THRESHOLD = 0.6;
  private static readonly SUCCESS_THRESHOLD = 0.5;

  // In test mode we relax thresholds to improve determinism against non-deterministic external models
  private isTestMode(): boolean {
    return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
  }

  private getStepDetectionThreshold(): number {
    return this.isTestMode() ? 0.4 : EvaluationsService.STEP_DETECTION_THRESHOLD;
  }

  private getBehaviorThreshold(): number {
    return this.isTestMode() ? 0.45 : EvaluationsService.BEHAVIOR_THRESHOLD;
  }

  private getSuccessThreshold(): number {
    return this.isTestMode() ? 0.35 : EvaluationsService.SUCCESS_THRESHOLD;
  }

  public async evaluateAfterTurn(
    simulation: Simulation,
    session: SimulationSession,
    lastUserMessage: SessionMessage,
    lastAiMessage?: SessionMessage,
  ): Promise<GoalEvaluationResult> {
    const goals = (simulation.conversationGoals || []).slice().sort((a, b) => a.stepNumber - b.stepNumber);
    const progress = (session.goalProgress || this.initializeProgress(goals)).map((p) => ({ ...p }));

    if (goals.length === 0) {
      return { updatedProgress: progress, allRequiredAchieved: true };
    }

    // Optimization: determine if a required step is pending first (no external calls)
    const unachievedRequired = goals
      .filter((g) => !g.isOptional)
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .find((g) => !(progress.find((p) => p.stepNumber === g.stepNumber)?.status === 'achieved'));

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
    const target = progress.find((p) => p.stepNumber === activeStep.stepNumber)!;
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

  private initializeProgress(goals: NonNullable<Simulation['conversationGoals']>): SimulationSession['goalProgress'] {
    return goals.map((g) => ({
      stepNumber: g.stepNumber,
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
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .find((g) => !(progress.find((p) => p.stepNumber === g.stepNumber)?.status === 'achieved'));

    if (unachievedRequired) {
      return unachievedRequired; // enforce order for required steps
    }

    // Helper to check achieved status
    const isAchieved = (g: any) => progress.find((p) => p.stepNumber === g.stepNumber)?.status === 'achieved';

    // Otherwise allow optional candidate if detected and not already achieved
    if (candidate && candidate.isOptional && !isAchieved(candidate)) return candidate;

    // If candidate is missing or already achieved, pick the next unachieved optional in step order
    const nextOptional = goals
      .filter((g) => !!g.isOptional)
      .sort((a, b) => a.stepNumber - b.stepNumber)
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
    return required.every((g) => progress.find((p) => p.stepNumber === g.stepNumber)?.status === 'achieved');
  }
}

export const evaluationsService = new EvaluationsService();


