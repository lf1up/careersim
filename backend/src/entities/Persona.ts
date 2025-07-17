import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Simulation } from './Simulation';

export enum PersonaCategory {
  JOB_SEEKING = 'job_seeking',
  WORKPLACE_COMMUNICATION = 'workplace_communication',
  LEADERSHIP = 'leadership',
}

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
  @OneToMany(() => Simulation, (simulation) => simulation.persona)
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