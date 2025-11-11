/**
 * Evaluation Framework for Simulation Testing
 * 
 * Provides utilities to assess conversation quality against simulation success criteria,
 * evaluate goal progress, and generate comprehensive evaluation reports.
 */

import { Turn } from 'deepeval-ts';
import { ConversationOutput } from './helpers';

/**
 * Success criteria from simulation definition
 */
export interface SuccessCriteria {
  communication: string[];
  problemSolving: string[];
  emotional: string[];
}

/**
 * Conversation goal from simulation definition
 */
export interface ConversationGoal {
  goalNumber: number;
  isOptional?: boolean;
  title: string;
  description: string;
  keyBehaviors: string[];
  successIndicators: string[];
}

/**
 * Goal progress from graph state
 */
export interface GoalProgress {
  goalNumber: number;
  title: string;
  status: 'not_started' | 'in_progress' | 'achieved';
  confidence: number;
}

/**
 * Evaluation result for a single criterion
 */
export interface CriterionEvaluation {
  criterion: string;
  satisfied: boolean;
  confidence: number;
  evidence: string[];
}

/**
 * Success criteria evaluation result
 */
export interface SuccessCriteriaEvaluation {
  communication: CriterionEvaluation[];
  problemSolving: CriterionEvaluation[];
  emotional: CriterionEvaluation[];
  overallScore: number;
}

/**
 * Goal evaluation result
 */
export interface GoalEvaluation {
  goalNumber: number;
  title: string;
  achieved: boolean;
  inProgress: boolean;
  confidence: number;
  isOptional: boolean;
}

/**
 * Overall simulation evaluation result
 */
export interface SimulationEvaluation {
  simulationSlug: string;
  turnCount: number;
  successCriteria: SuccessCriteriaEvaluation;
  goals: GoalEvaluation[];
  overallScore: number;
  passed: boolean;
  summary: string;
}

/**
 * Evaluate success criteria based on conversation turns
 * 
 * This is a heuristic evaluation based on keyword matching and conversation patterns.
 * In a production system, this could use LLM-based evaluation.
 */
export function evaluateSuccessCriteria(
  turns: Turn[],
  successCriteria: SuccessCriteria
): SuccessCriteriaEvaluation {
  const communication = evaluateCriteria(turns, successCriteria.communication, 'communication');
  const problemSolving = evaluateCriteria(turns, successCriteria.problemSolving, 'problemSolving');
  const emotional = evaluateCriteria(turns, successCriteria.emotional, 'emotional');

  const allCriteria = [...communication, ...problemSolving, ...emotional];
  const satisfiedCount = allCriteria.filter(c => c.satisfied).length;
  const overallScore = allCriteria.length > 0 ? (satisfiedCount / allCriteria.length) * 100 : 0;

  return {
    communication,
    problemSolving,
    emotional,
    overallScore,
  };
}

/**
 * Evaluate individual criteria within a category
 */
function evaluateCriteria(
  turns: Turn[],
  criteria: string[],
  category: string
): CriterionEvaluation[] {
  return criteria.map(criterion => {
    const keywords = extractKeywords(criterion);
    const evidence: string[] = [];
    let matchCount = 0;

    // Check for keyword matches in user turns
    const userTurns = turns.filter(t => t.role === 'user');
    for (const turn of userTurns) {
      const content = turn.content.toLowerCase();
      const matched = keywords.some(kw => content.includes(kw.toLowerCase()));
      if (matched) {
        matchCount++;
        evidence.push(turn.content.substring(0, 100) + '...');
      }
    }

    // Heuristic: satisfied if we found evidence in at least 20% of user turns
    const threshold = Math.max(1, Math.ceil(userTurns.length * 0.2));
    const satisfied = matchCount >= threshold;
    const confidence = Math.min(1, matchCount / threshold);

    return {
      criterion,
      satisfied,
      confidence,
      evidence: evidence.slice(0, 3), // Keep top 3 evidence examples
    };
  });
}

/**
 * Extract keywords from a criterion string for matching
 */
function extractKeywords(criterion: string): string[] {
  // Remove common words and extract meaningful terms
  const stopWords = ['the', 'and', 'or', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with'];
  const words = criterion.toLowerCase().split(/\s+/);
  return words
    .filter(w => w.length > 3 && !stopWords.includes(w))
    .map(w => w.replace(/[^\w]/g, ''));
}

/**
 * Evaluate goal progress from the conversation
 */
export function evaluateGoalProgress(
  goalProgress: GoalProgress[],
  conversationGoals: ConversationGoal[]
): GoalEvaluation[] {
  return conversationGoals.map(goal => {
    const progress = goalProgress.find(gp => gp.goalNumber === goal.goalNumber);
    
    return {
      goalNumber: goal.goalNumber,
      title: goal.title,
      achieved: progress?.status === 'achieved',
      inProgress: progress?.status === 'in_progress',
      confidence: progress?.confidence || 0,
      isOptional: goal.isOptional || false,
    };
  });
}

/**
 * Calculate overall simulation score
 */
export function calculateSimulationScore(
  successCriteriaScore: number,
  goalEvaluations: GoalEvaluation[]
): number {
  // Weight: 40% success criteria, 60% goal achievement
  const successCriteriaWeight = 0.4;
  const goalsWeight = 0.6;

  // Calculate goal score
  const requiredGoals = goalEvaluations.filter(g => !g.isOptional);
  const optionalGoals = goalEvaluations.filter(g => g.isOptional);
  
  const requiredAchieved = requiredGoals.filter(g => g.achieved || g.inProgress).length;
  const optionalAchieved = optionalGoals.filter(g => g.achieved || g.inProgress).length;
  
  // Required goals are more important (80% weight), optional goals are 20%
  const requiredScore = requiredGoals.length > 0 
    ? (requiredAchieved / requiredGoals.length) * 100 
    : 100;
  const optionalScore = optionalGoals.length > 0 
    ? (optionalAchieved / optionalGoals.length) * 100 
    : 100;
  
  const goalScore = (requiredScore * 0.8) + (optionalScore * 0.2);

  // Calculate weighted overall score
  const overallScore = (successCriteriaScore * successCriteriaWeight) + (goalScore * goalsWeight);

  return Math.round(overallScore * 10) / 10; // Round to 1 decimal place
}

/**
 * Generate human-readable evaluation report
 */
export function generateEvaluationReport(
  simulationSlug: string,
  turnCount: number,
  successCriteria: SuccessCriteriaEvaluation,
  goalEvaluations: GoalEvaluation[],
  overallScore: number
): SimulationEvaluation {
  const passed = overallScore >= 70; // 70% threshold for passing

  // Generate summary
  const requiredGoals = goalEvaluations.filter(g => !g.isOptional);
  const requiredAchieved = requiredGoals.filter(g => g.achieved || g.inProgress).length;
  const optionalGoals = goalEvaluations.filter(g => g.isOptional);
  const optionalAchieved = optionalGoals.filter(g => g.achieved || g.inProgress).length;

  const summary = `
Simulation: ${simulationSlug}
Status: ${passed ? '✅ PASSED' : '❌ FAILED'}
Overall Score: ${overallScore}%

Turn Count: ${turnCount}

Success Criteria: ${successCriteria.overallScore.toFixed(1)}%
  - Communication: ${successCriteria.communication.filter(c => c.satisfied).length}/${successCriteria.communication.length}
  - Problem Solving: ${successCriteria.problemSolving.filter(c => c.satisfied).length}/${successCriteria.problemSolving.length}
  - Emotional: ${successCriteria.emotional.filter(c => c.satisfied).length}/${successCriteria.emotional.length}

Goal Achievement:
  - Required: ${requiredAchieved}/${requiredGoals.length} (${requiredGoals.length > 0 ? Math.round((requiredAchieved / requiredGoals.length) * 100) : 100}%)
  - Optional: ${optionalAchieved}/${optionalGoals.length} (${optionalGoals.length > 0 ? Math.round((optionalAchieved / optionalGoals.length) * 100) : 100}%)
  `.trim();

  return {
    simulationSlug,
    turnCount,
    successCriteria,
    goals: goalEvaluations,
    overallScore,
    passed,
    summary,
  };
}

/**
 * Assert minimum goal achievement threshold
 */
export function assertGoalAchievement(
  goalEvaluations: GoalEvaluation[],
  minRequiredPercentage: number = 70
): void {
  const requiredGoals = goalEvaluations.filter(g => !g.isOptional);
  if (requiredGoals.length === 0) {
    return; // No required goals, pass
  }

  const achieved = requiredGoals.filter(g => g.achieved || g.inProgress).length;
  const percentage = (achieved / requiredGoals.length) * 100;

  if (percentage < minRequiredPercentage) {
    throw new Error(
      `Goal achievement below threshold: ${percentage.toFixed(1)}% (minimum: ${minRequiredPercentage}%)\n` +
      `Required goals achieved: ${achieved}/${requiredGoals.length}`
    );
  }
}

/**
 * Log detailed evaluation results
 */
export function logEvaluationDetails(evaluation: SimulationEvaluation): void {
  console.log('\n' + '═'.repeat(80));
  console.log('📊 EVALUATION REPORT');
  console.log('═'.repeat(80));
  console.log(evaluation.summary);
  console.log('═'.repeat(80));

  console.log('\n📋 DETAILED SUCCESS CRITERIA BREAKDOWN');
  console.log('─'.repeat(80));
  
  console.log('\n🗣️  Communication Criteria:');
  if (evaluation.successCriteria.communication.length === 0) {
    console.log('   (No communication criteria defined)');
  } else {
    evaluation.successCriteria.communication.forEach((c, idx) => {
      const icon = c.satisfied ? '✅' : '❌';
      const confidenceBar = '█'.repeat(Math.round(c.confidence * 10)) + '░'.repeat(10 - Math.round(c.confidence * 10));
      console.log(`   ${idx + 1}. ${icon} ${c.criterion}`);
      console.log(`      Confidence: [${confidenceBar}] ${(c.confidence * 100).toFixed(0)}%`);
      if (c.evidence.length > 0) {
        console.log(`      Evidence: Found in ${c.evidence.length} turn(s)`);
      }
    });
  }

  console.log('\n🧩 Problem Solving Criteria:');
  if (evaluation.successCriteria.problemSolving.length === 0) {
    console.log('   (No problem solving criteria defined)');
  } else {
    evaluation.successCriteria.problemSolving.forEach((c, idx) => {
      const icon = c.satisfied ? '✅' : '❌';
      const confidenceBar = '█'.repeat(Math.round(c.confidence * 10)) + '░'.repeat(10 - Math.round(c.confidence * 10));
      console.log(`   ${idx + 1}. ${icon} ${c.criterion}`);
      console.log(`      Confidence: [${confidenceBar}] ${(c.confidence * 100).toFixed(0)}%`);
      if (c.evidence.length > 0) {
        console.log(`      Evidence: Found in ${c.evidence.length} turn(s)`);
      }
    });
  }

  console.log('\n❤️  Emotional Criteria:');
  if (evaluation.successCriteria.emotional.length === 0) {
    console.log('   (No emotional criteria defined)');
  } else {
    evaluation.successCriteria.emotional.forEach((c, idx) => {
      const icon = c.satisfied ? '✅' : '❌';
      const confidenceBar = '█'.repeat(Math.round(c.confidence * 10)) + '░'.repeat(10 - Math.round(c.confidence * 10));
      console.log(`   ${idx + 1}. ${icon} ${c.criterion}`);
      console.log(`      Confidence: [${confidenceBar}] ${(c.confidence * 100).toFixed(0)}%`);
      if (c.evidence.length > 0) {
        console.log(`      Evidence: Found in ${c.evidence.length} turn(s)`);
      }
    });
  }

  console.log('\n─'.repeat(80));
  console.log('\n🎯 CONVERSATION GOALS PROGRESS');
  console.log('─'.repeat(80));
  
  const requiredGoals = evaluation.goals.filter(g => !g.isOptional);
  const optionalGoals = evaluation.goals.filter(g => g.isOptional);
  
  if (requiredGoals.length > 0) {
    console.log('\n✦ Required Goals:');
    requiredGoals.forEach(g => {
      const status = g.achieved ? '✅ Achieved' : g.inProgress ? '🔄 In Progress' : '⏸️  Not Started';
      const confidenceBar = '█'.repeat(Math.round(g.confidence * 10)) + '░'.repeat(10 - Math.round(g.confidence * 10));
      console.log(`   ${status} Goal ${g.goalNumber}: ${g.title}`);
      console.log(`      Progress: [${confidenceBar}] ${(g.confidence * 100).toFixed(0)}%`);
    });
  }
  
  if (optionalGoals.length > 0) {
    console.log('\n✧ Optional Goals:');
    optionalGoals.forEach(g => {
      const status = g.achieved ? '✅ Achieved' : g.inProgress ? '🔄 In Progress' : '⏸️  Not Started';
      const confidenceBar = '█'.repeat(Math.round(g.confidence * 10)) + '░'.repeat(10 - Math.round(g.confidence * 10));
      console.log(`   ${status} Goal ${g.goalNumber}: ${g.title}`);
      console.log(`      Progress: [${confidenceBar}] ${(g.confidence * 100).toFixed(0)}%`);
    });
  }

  console.log('\n' + '═'.repeat(80) + '\n');
}

