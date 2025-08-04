import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  Index,
} from 'typeorm';
import { Simulation } from './Simulation';

export enum PersonaCategory {
  JOB_SEEKING = 'job_seeking',
  WORKPLACE_COMMUNICATION = 'workplace_communication',
  LEADERSHIP = 'leadership',
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Persona:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "123e4567-e89b-12d3-a456-426614174000"
 *         name:
 *           type: string
 *           maxLength: 255
 *           example: "Sarah Johnson"
 *         slug:
 *           type: string
 *           maxLength: 255
 *           example: "sarah-johnson"
 *         role:
 *           type: string
 *           maxLength: 255
 *           example: "Senior HR Manager"
 *         personality:
 *           type: string
 *           example: "Professional, direct, and results-oriented"
 *         primaryGoal:
 *           type: string
 *           example: "Find the best candidate for senior positions"
 *         hiddenMotivation:
 *           type: string
 *           example: "Under pressure to fill positions quickly"
 *         category:
 *           type: string
 *           enum: [job_seeking, workplace_communication, leadership]
 *           example: "job_seeking"
 *         avatarUrl:
 *           type: string
 *           nullable: true
 *           maxLength: 255
 *           example: "https://example.com/avatars/sarah.jpg"
 *         backgroundStory:
 *           type: string
 *           nullable: true
 *           example: "Sarah has been in HR for 10 years and values efficiency"
 *         conversationStyle:
 *           type: object
 *           nullable: true
 *           properties:
 *             tone:
 *               type: string
 *               example: "professional"
 *             formality:
 *               type: string
 *               example: "formal"
 *             pace:
 *               type: string
 *               example: "fast"
 *             emotionalRange:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["focused", "impatient", "analytical"]
 *             commonPhrases:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Let's get to the point", "Time is valuable"]
 *         triggerWords:
 *           type: array
 *           nullable: true
 *           items:
 *             type: string
 *           example: ["inexperienced", "unclear"]
 *         responsePatterns:
 *           type: object
 *           nullable: true
 *           properties:
 *             positive:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Excellent point", "That's exactly what we need"]
 *             negative:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["I'm not convinced", "That's concerning"]
 *             neutral:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Tell me more", "I see"]
 *         difficultyLevel:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           example: 3
 *         isActive:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         simulations:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Simulation'
 *         displayName:
 *           type: string
 *           example: "Sarah Johnson - Senior HR Manager"
 *         difficultyText:
 *           type: string
 *           example: "Advanced"
 */

@Entity('personas')
@Index(['slug'], { unique: true })
export class Persona {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  slug!: string;

  @Column({ type: 'varchar', length: 255 })
  role!: string;

  @Column({ type: 'text' })
  personality!: string;

  @Column({ type: 'text' })
  primaryGoal!: string;

  @Column({ type: 'text' })
  hiddenMotivation!: string;

  @Column({
    type: 'enum',
    enum: PersonaCategory,
  })
  category!: PersonaCategory;

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatarUrl?: string;

  @Column({ type: 'text', nullable: true })
  backgroundStory?: string;

  @Column({ type: 'json', nullable: true })
  conversationStyle?: {
    tone: string;
    formality: string;
    pace: string;
    emotionalRange: string[];
    commonPhrases: string[];
  };

  @Column({ type: 'json', nullable: true })
  triggerWords?: string[];

  @Column({ type: 'json', nullable: true })
  responsePatterns?: {
    positive: string[];
    negative: string[];
    neutral: string[];
  };

  @Column({ type: 'int', default: 1 })
  difficultyLevel!: number; // 1-5 scale

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relationships
  @ManyToMany(() => Simulation, (simulation) => simulation.personas)
  simulations!: Simulation[];

  // Methods
  get displayName(): string {
    return `${this.name} - ${this.role}`;
  }

  get difficultyText(): string {
    const levels = ['', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Master'];
    return levels[this.difficultyLevel] || 'Unknown';
  }
} 