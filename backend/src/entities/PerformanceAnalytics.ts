import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
  Relation,
} from 'typeorm';
import { SimulationSession } from './SimulationSession';

/**
 * @swagger
 * components:
 *   schemas:
 *     PerformanceAnalytics:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "123e4567-e89b-12d3-a456-426614174000"
 *         sessionId:
 *           type: string
 *           format: uuid
 *           example: "123e4567-e89b-12d3-a456-426614174000"
 *         overallScore:
 *           type: number
 *           format: decimal
 *           minimum: 0
 *           maximum: 100
 *           example: 87.5
 *         detailedScores:
 *           type: object
 *           properties:
 *             communication:
 *               type: object
 *               properties:
 *                 score:
 *                   type: number
 *                   example: 85
 *                 breakdown:
 *                   type: object
 *                   properties:
 *                     clarity:
 *                       type: number
 *                       example: 90
 *                     persuasiveness:
 *                       type: number
 *                       example: 80
 *                     activeListening:
 *                       type: number
 *                       example: 85
 *                     empathy:
 *                       type: number
 *                       example: 85
 *             problemSolving:
 *               type: object
 *               properties:
 *                 score:
 *                   type: number
 *                   example: 88
 *                 breakdown:
 *                   type: object
 *                   properties:
 *                     analyticalThinking:
 *                       type: number
 *                       example: 90
 *                     creativity:
 *                       type: number
 *                       example: 85
 *                     decisionMaking:
 *                       type: number
 *                       example: 90
 *                     adaptability:
 *                       type: number
 *                       example: 85
 *             emotional:
 *               type: object
 *               properties:
 *                 score:
 *                   type: number
 *                   example: 82
 *                 breakdown:
 *                   type: object
 *                   properties:
 *                     selfAwareness:
 *                       type: number
 *                       example: 85
 *                     emotionalRegulation:
 *                       type: number
 *                       example: 80
 *                     socialAwareness:
 *                       type: number
 *                       example: 80
 *                     relationshipManagement:
 *                       type: number
 *                       example: 85
 *             outcome:
 *               type: object
 *               properties:
 *                 score:
 *                   type: number
 *                   example: 90
 *                 breakdown:
 *                   type: object
 *                   properties:
 *                     goalAchievement:
 *                       type: number
 *                       example: 95
 *                     efficiency:
 *                       type: number
 *                       example: 85
 *                     satisfaction:
 *                       type: number
 *                       example: 90
 *         sentimentAnalysis:
 *           type: object
 *           properties:
 *             overallSentiment:
 *               type: string
 *               enum: [positive, neutral, negative]
 *               example: "positive"
 *             sentimentProgression:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   messageNumber:
 *                     type: number
 *                     example: 3
 *                   sentiment:
 *                     type: string
 *                     enum: [positive, neutral, negative]
 *                     example: "positive"
 *                   confidence:
 *                     type: number
 *                     example: 0.85
 *             emotionalStability:
 *               type: number
 *               example: 0.8
 *             positivityRatio:
 *               type: number
 *               example: 0.75
 *         communicationMetrics:
 *           type: object
 *           properties:
 *             totalWords:
 *               type: number
 *               example: 450
 *             averageWordsPerMessage:
 *               type: number
 *               example: 30
 *             fillerWordsCount:
 *               type: number
 *               example: 5
 *             questionToStatementRatio:
 *               type: number
 *               example: 0.3
 *             collaborativeLanguageUsage:
 *               type: number
 *               example: 0.7
 *             directiveLanguageUsage:
 *               type: number
 *               example: 0.3
 *             averageResponseTime:
 *               type: number
 *               example: 15.5
 *             conversationFlow:
 *               type: number
 *               example: 0.85
 *         keyInsights:
 *           type: object
 *           properties:
 *             strengths:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Clear communication", "Strong problem-solving"]
 *             improvementAreas:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Ask more follow-up questions", "Show more empathy"]
 *             criticalMoments:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   messageNumber:
 *                     type: number
 *                     example: 5
 *                   description:
 *                     type: string
 *                     example: "Handled difficult question well"
 *                   impact:
 *                     type: string
 *                     enum: [positive, negative]
 *                     example: "positive"
 *                   suggestion:
 *                     type: string
 *                     example: "Continue this approach"
 *             personaSpecificFeedback:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Good adaptation to interviewer's style"]
 *         comparisonData:
 *           type: object
 *           properties:
 *             personalBest:
 *               type: boolean
 *               example: true
 *             improvementFromLastSession:
 *               type: number
 *               example: 12.5
 *             categoryAverageComparison:
 *               type: number
 *               example: 8.2
 *             overallUserRanking:
 *               type: number
 *               example: 75
 *         aiGeneratedFeedback:
 *           type: string
 *           example: "Great performance! You demonstrated excellent communication skills..."
 *         actionableRecommendations:
 *           type: object
 *           properties:
 *             immediate:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Practice active listening techniques"]
 *             shortTerm:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Develop emotional intelligence skills"]
 *             longTerm:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Consider leadership training"]
 *             resourceSuggestions:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [article, video, simulation, book]
 *                     example: "article"
 *                   title:
 *                     type: string
 *                     example: "Effective Communication Strategies"
 *                   url:
 *                     type: string
 *                     nullable: true
 *                     example: "https://example.com/article"
 *                   description:
 *                     type: string
 *                     example: "Learn advanced communication techniques"
 *         transcriptHighlights:
 *           type: array
 *           nullable: true
 *           items:
 *             type: object
 *             properties:
 *               messageId:
 *                 type: string
 *                 example: "123e4567-e89b-12d3-a456-426614174000"
 *               messageNumber:
 *                 type: number
 *                 example: 5
 *               text:
 *                 type: string
 *                 example: "I have experience leading teams..."
 *               highlightReason:
 *                 type: string
 *                 example: "Demonstrated leadership experience"
 *               category:
 *                 type: string
 *                 enum: [strength, improvement, critical, neutral]
 *                 example: "strength"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         session:
 *           $ref: '#/components/schemas/SimulationSession'
 *         hasExcellentPerformance:
 *           type: boolean
 *           example: true
 *         needsImprovement:
 *           type: boolean
 *           example: false
 *         strongestSkill:
 *           type: string
 *           example: "communication"
 *         weakestSkill:
 *           type: string
 *           example: "emotional"
 */

@Entity('performance_analytics')
export class PerformanceAnalytics {
  @PrimaryGeneratedColumn('uuid')
    id!: string;

  @Column({ type: 'uuid' })
    sessionId!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
    overallScore!: number;

  @Column({ type: 'json' })
    detailedScores!: {
    communication: {
      score: number;
      breakdown: {
        clarity: number;
        persuasiveness: number;
        activeListening: number;
        empathy: number;
      };
    };
    problemSolving: {
      score: number;
      breakdown: {
        analyticalThinking: number;
        creativity: number;
        decisionMaking: number;
        adaptability: number;
      };
    };
    emotional: {
      score: number;
      breakdown: {
        selfAwareness: number;
        emotionalRegulation: number;
        socialAwareness: number;
        relationshipManagement: number;
      };
    };
    outcome: {
      score: number;
      breakdown: {
        goalAchievement: number;
        efficiency: number;
        satisfaction: number;
      };
    };
  };

  @Column({ type: 'json' })
    sentimentAnalysis!: {
    overallSentiment: 'positive' | 'neutral' | 'negative';
    sentimentProgression: Array<{
      messageNumber: number;
      sentiment: 'positive' | 'neutral' | 'negative';
      confidence: number;
    }>;
    emotionalStability: number;
    positivityRatio: number;
  };

  @Column({ type: 'json' })
    communicationMetrics!: {
    totalWords: number;
    averageWordsPerMessage: number;
    fillerWordsCount: number;
    questionToStatementRatio: number;
    collaborativeLanguageUsage: number;
    directiveLanguageUsage: number;
    averageResponseTime: number;
    conversationFlow: number;
  };

  @Column({ type: 'json' })
    keyInsights!: {
    strengths: string[];
    improvementAreas: string[];
    criticalMoments: Array<{
      messageNumber: number;
      description: string;
      impact: 'positive' | 'negative';
      suggestion: string;
    }>;
    personaSpecificFeedback: string[];
  };

  @Column({ type: 'json' })
    comparisonData!: {
    personalBest: boolean;
    improvementFromLastSession: number;
    categoryAverageComparison: number;
    overallUserRanking: number;
  };

  @Column({ type: 'text' })
    aiGeneratedFeedback!: string;

  @Column({ type: 'json' })
    actionableRecommendations!: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
    resourceSuggestions: Array<{
      type: 'article' | 'video' | 'simulation' | 'book';
      title: string;
      url?: string;
      description: string;
    }>;
  };

  @Column({ type: 'json', nullable: true })
    transcriptHighlights?: Array<{
    messageId: string;
    messageNumber: number;
    text: string;
    highlightReason: string;
    category: 'strength' | 'improvement' | 'critical' | 'neutral';
  }>;

  @CreateDateColumn()
    createdAt!: Date;

  // Relationships
  @OneToOne(() => SimulationSession, (session) => session.analytics)
  @JoinColumn({ name: 'sessionId' })
    session!: Relation<SimulationSession>;

  // Methods
  get hasExcellentPerformance(): boolean {
    return this.overallScore >= 85;
  }

  get needsImprovement(): boolean {
    return this.overallScore < 60;
  }

  get strongestSkill(): string {
    const scores = this.detailedScores;
    const skillScores = {
      communication: scores.communication.score,
      problemSolving: scores.problemSolving.score,
      emotional: scores.emotional.score,
      outcome: scores.outcome.score,
    };

    return Object.keys(skillScores).reduce((a, b) => 
      skillScores[a as keyof typeof skillScores] > skillScores[b as keyof typeof skillScores] ? a : b,
    );
  }

  get weakestSkill(): string {
    const scores = this.detailedScores;
    const skillScores = {
      communication: scores.communication.score,
      problemSolving: scores.problemSolving.score,
      emotional: scores.emotional.score,
      outcome: scores.outcome.score,
    };

    return Object.keys(skillScores).reduce((a, b) => 
      skillScores[a as keyof typeof skillScores] < skillScores[b as keyof typeof skillScores] ? a : b,
    );
  }

  getSkillLevel(score: number): string {
    if (score >= 90) return 'Expert';
    if (score >= 80) return 'Advanced';
    if (score >= 70) return 'Intermediate';
    if (score >= 60) return 'Beginner';
    return 'Needs Development';
  }
} 
