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

    const candidateStep = await this.detectCandidateStep(lastUserMessage.content, goals);
    const activeStep = this.selectActiveStep(candidateStep, goals, progress);
    if (!activeStep) {
      return { updatedProgress: progress, allRequiredAchieved: this.requiredAchieved(progress, goals) };
    }

    // mark started
    const target = progress.find((p) => p.stepNumber === activeStep.stepNumber)!;
    if (target.status === 'not_started') {
      target.status = 'in_progress';
      target.startedAt = new Date().toISOString();
    }

    // Behavior evidence on user message
    const behaviorScore = await this.scoreAgainstLabels(lastUserMessage.content, activeStep.keyBehaviors || []);
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

    // Success indicators using AI reply + emotion/sentiment
    let successScore = 0;
    if (lastAiMessage) {
      const indicatorScore = await this.scoreAgainstLabels(lastAiMessage.content, activeStep.successIndicators || []);
      
      // Use stored metadata instead of re-analyzing
      let emotion: { emotion: string; confidence: number };
      let sentiment: { sentiment: 'positive' | 'neutral' | 'negative'; confidence: number };
      
      if (lastAiMessage.metadata?.emotionAnalysis && lastAiMessage.metadata?.sentimentAnalysis) {
        // Use cached analysis from AI response generation
        emotion = lastAiMessage.metadata.emotionAnalysis;
        sentiment = lastAiMessage.metadata.sentimentAnalysis;
      } else {
        // Fallback: Only analyze if not already stored (for backwards compatibility)
        console.warn('🔄 No cached emotion/sentiment analysis found in message metadata, falling back to re-analysis');
        emotion = await transformersService.analyzeEmotion(lastAiMessage.content);
        sentiment = await transformersService.analyzeSentiment(lastAiMessage.content);
      }

      // Simple heuristic boost when emotion/sentiment imply progress
      const toneBoost = (['friendly', 'encouraging', 'neutral'].includes(emotion.emotion) && sentiment.sentiment !== 'negative') ? 0.1 : 0;
      successScore = Math.max(0, Math.min(1, (Number.isNaN(indicatorScore) ? 0 : indicatorScore) + toneBoost));

      if (!target.evidence) target.evidence = [];
      target.evidence.push({
        messageId: lastAiMessage.id,
        role: 'ai',
        label: 'success',
        score: successScore,
      });
    }

    const behaviorOk = (target.confidence || 0) >= EvaluationsService.BEHAVIOR_THRESHOLD || (behaviorScore || 0) >= EvaluationsService.BEHAVIOR_THRESHOLD;
    const successOk = (activeStep.successIndicators && activeStep.successIndicators.length > 0)
      ? successScore >= EvaluationsService.SUCCESS_THRESHOLD
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
    if (result.confidence >= EvaluationsService.STEP_DETECTION_THRESHOLD) {
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

    // Otherwise allow optional candidate if detected
    if (candidate && candidate.isOptional) return candidate;

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


