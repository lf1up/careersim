import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { SimulationSession } from './SimulationSession';

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
  session!: SimulationSession;

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
      skillScores[a as keyof typeof skillScores] > skillScores[b as keyof typeof skillScores] ? a : b
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
      skillScores[a as keyof typeof skillScores] < skillScores[b as keyof typeof skillScores] ? a : b
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