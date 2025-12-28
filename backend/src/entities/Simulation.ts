import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinTable,
  JoinColumn,
  Index,
  Relation,
} from 'typeorm';
import { Category } from './Category';
import { Persona } from './Persona';
import { SimulationSession } from './SimulationSession';

// Conversation goal types used to drive step tracking during a session
export interface ConversationGoal {
  goalNumber: number;
  isOptional?: boolean;
  title: string;
  description: string;
  keyBehaviors?: string[];
  successIndicators?: string[];
  /**
   * Optional per-goal evaluation tuning.
   * These values are used by LangGraph goal evaluation to control strictness and evidence requirements.
   *
   * All values are optional; evaluator falls back to global defaults when omitted.
   */
  evaluationConfig?: {
    /** Threshold for matching the user's message against keyBehaviors (0..1). */
    behaviorThreshold?: number;
    /** Threshold for matching the AI's message against successIndicators (0..1). */
    successThreshold?: number;
    /** Score considered "strong evidence" (0..1). Default: 0.65 */
    strongEvidenceScore?: number;
    /** Minimum number of evidence items (any score) required. Default: 2 */
    minEvidenceCount?: number;
    /** Minimum number of strong evidence items (score >= strongEvidenceScore) required. Default: 2 */
    minStrongEvidenceCount?: number;
    /**
     * Whether successIndicators must be met (when present) to achieve the goal.
     * Default: true.
     */
    requireSuccessIndicators?: boolean;
  };
}

export enum SimulationDifficulty {
  BEGINNER = 1,
  INTERMEDIATE = 2,
  ADVANCED = 3,
  EXPERT = 4,
  MASTER = 5,
}

export enum SimulationStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Simulation:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "123e4567-e89b-12d3-a456-426614174000"
 *         title:
 *           type: string
 *           maxLength: 255
 *           example: "Mock Job Interview"
 *         slug:
 *           type: string
 *           maxLength: 255
 *           example: "mock-job-interview"
 *         description:
 *           type: string
 *           example: "Practice your interview skills with an AI interviewer"
 *         scenario:
 *           type: string
 *           example: "You are interviewing for a senior software engineer position"
 *         objectives:
 *           type: string
 *           example: "Demonstrate technical knowledge and communication skills"
 *         conversationGoals:
 *           type: array
 *           nullable: true
 *           items:
 *             type: object
 *             properties:
 *               goalNumber:
 *                 type: integer
 *                 example: 1
 *               isOptional:
 *                 type: boolean
 *                 example: false
 *               title:
 *                 type: string
 *                 example: "Opening and Rapport Building"
 *               description:
 *                 type: string
 *                 example: "Start the interview with a professional greeting and attempt to build initial rapport"
 *               keyBehaviors:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Professional greeting", "Express appreciation for the opportunity"]
 *               successIndicators:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Interviewer appears more relaxed", "Professional tone is established"]
 *         difficulty:
 *           type: integer
 *           enum: [1, 2, 3, 4, 5]
 *           example: 2
 *         status:
 *           type: string
 *           enum: [draft, published, archived]
 *           example: "published"
 *         thumbnailUrl:
 *           type: string
 *           nullable: true
 *           maxLength: 255
 *           example: "https://example.com/thumbnails/interview.jpg"
 *         estimatedDurationMinutes:
 *           type: integer
 *           minimum: 1
 *           example: 30
 *         skillsToLearn:
 *           type: array
 *           nullable: true
 *           items:
 *             type: string
 *           example: ["Interview skills", "Communication", "Technical presentation"]
 *         successCriteria:
 *           type: object
 *           nullable: true
 *           properties:
 *             communication:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Clear articulation", "Active listening"]
 *             problemSolving:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Structured thinking", "Solution-oriented approach"]
 *             emotional:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Confidence", "Composure under pressure"]
 *         preparationTips:
 *           type: string
 *           nullable: true
 *           example: "Review common interview questions and practice your responses"
 *         contextualBackground:
 *           type: string
 *           nullable: true
 *           example: "This company values innovation and teamwork"
 *         evaluationMetrics:
 *           type: object
 *           nullable: true
 *           properties:
 *             scoreWeights:
 *               type: object
 *               properties:
 *                 communication:
 *                   type: number
 *                   example: 0.3
 *                 problemSolving:
 *                   type: number
 *                   example: 0.3
 *                 emotional:
 *                   type: number
 *                   example: 0.2
 *                 outcome:
 *                   type: number
 *                   example: 0.2
 *             keyIndicators:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Eye contact", "Clarity", "Confidence"]
 *         isPremiumOnly:
 *           type: boolean
 *           example: false
 *         completionCount:
 *           type: integer
 *           minimum: 0
 *           example: 150
 *         averageRating:
 *           type: number
 *           format: decimal
 *           minimum: 0
 *           maximum: 5
 *           example: 4.2
 *         sortOrder:
 *           type: integer
 *           minimum: 0
 *           example: 1
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         category:
 *           $ref: '#/components/schemas/Category'
 *         persona:
 *           $ref: '#/components/schemas/Persona'
 *         sessions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SimulationSession'
 *         difficultyText:
 *           type: string
 *           example: "Intermediate"
 *         isPublished:
 *           type: boolean
 *           example: true
 *         sessionCount:
 *           type: integer
 *           minimum: 0
 *           example: 25
 *         completionRate:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *           example: 75.5
 */

@Entity('simulations')
@Index(['slug'], { unique: true })
export class Simulation {
  @PrimaryGeneratedColumn('uuid')
    id!: string;

  @Column({ type: 'varchar', length: 255 })
    title!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
    slug!: string;

  @Column({ type: 'text' })
    description!: string;

  @Column({ type: 'text' })
    scenario!: string;

  @Column({ type: 'json', default: '[]' })
    objectives!: string[];

  // Conversation goals for tracking progress during a session
  @Column({ type: 'json', nullable: true })
    conversationGoals?: ConversationGoal[];

  @Column({
    type: 'enum',
    enum: SimulationDifficulty,
    default: SimulationDifficulty.BEGINNER,
  })
    difficulty!: SimulationDifficulty;

  @Column({
    type: 'enum',
    enum: SimulationStatus,
    default: SimulationStatus.DRAFT,
  })
    status!: SimulationStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
    thumbnailUrl?: string;

  @Column({ type: 'int', default: 30 })
    estimatedDurationMinutes!: number;

  @Column({ type: 'json', nullable: true })
    skillsToLearn?: string[];

  @Column({ type: 'json', nullable: true })
    successCriteria?: {
    communication: string[];
    problemSolving: string[];
    emotional: string[];
  };

  @Column({ type: 'text', nullable: true })
    preparationTips?: string;

  @Column({ type: 'text', nullable: true })
    contextualBackground?: string;

  @Column({ type: 'json', nullable: true })
    evaluationMetrics?: {
    scoreWeights: {
      communication: number;
      problemSolving: number;
      emotional: number;
      outcome: number;
    };
    keyIndicators: string[];
  };

  @Column({ type: 'boolean', default: false })
    isPremiumOnly!: boolean;

  @Column({ type: 'int', default: 0 })
    completionCount!: number;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
    averageRating!: number;

  @Column({ type: 'int', default: 0 })
    sortOrder!: number;

  // Additional fields expected by frontend
  @Column({ type: 'json', default: '[]' })
    tags!: string[];

  @Column({ type: 'boolean', default: true })
    isPublic!: boolean;

  @Column({ type: 'int', default: 0 })
    viewCount!: number;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;

  // Relationships
  @ManyToOne(() => Category, (category) => category.simulations)
  @JoinColumn()
    category!: Relation<Category>;

  @ManyToMany(() => Persona, (persona) => persona.simulations)
  @JoinTable({
    name: 'simulation_personas',
    joinColumn: {
      name: 'simulationId',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'personaId',
      referencedColumnName: 'id',
    },
  })
    personas!: Persona[];

  @OneToMany(() => SimulationSession, (session) => session.simulation)
    sessions!: SimulationSession[];

  // Virtual properties
  get difficultyText(): string {
    const levels = ['', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Master'];
    return levels[this.difficulty] || 'Unknown';
  }

  get requiredGoalsCount(): number {
    const goals = this.conversationGoals || [];
    return goals.filter((g) => !g.isOptional).length;
  }

  get isPublished(): boolean {
    return this.status === SimulationStatus.PUBLISHED;
  }

  get sessionCount(): number {
    return this.sessions?.length || 0;
  }

  get completionRate(): number {
    if (!this.sessions || this.sessions.length === 0) return 0;
    const completedSessions = this.sessions.filter(session => session.isCompleted);
    return (completedSessions.length / this.sessions.length) * 100;
  }
} 
