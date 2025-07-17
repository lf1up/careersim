import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Category } from './Category';
import { Persona } from './Persona';
import { SimulationSession } from './SimulationSession';

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

  @Column({ type: 'text' })
  objectives!: string;

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relationships
  @ManyToOne(() => Category, (category) => category.simulations)
  @JoinColumn()
  category!: Category;

  @ManyToOne(() => Persona, (persona) => persona.simulations)
  @JoinColumn()
  persona!: Persona;

  @OneToMany(() => SimulationSession, (session) => session.simulation)
  sessions!: SimulationSession[];

  // Virtual properties
  get difficultyText(): string {
    const levels = ['', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Master'];
    return levels[this.difficulty] || 'Unknown';
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