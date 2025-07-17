import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { Simulation } from './Simulation';
import { SessionMessage } from './SessionMessage';
import { PerformanceAnalytics } from './PerformanceAnalytics';

export enum SessionStatus {
  STARTED = 'started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
  PAUSED = 'paused',
}

@Entity('simulation_sessions')
export class SimulationSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: SessionStatus,
    default: SessionStatus.STARTED,
  })
  status!: SessionStatus;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ type: 'int', default: 0 })
  durationSeconds!: number;

  @Column({ type: 'int', default: 0 })
  messageCount!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  overallScore?: number;

  @Column({ type: 'json', nullable: true })
  scores?: {
    communication: number;
    problemSolving: number;
    emotional: number;
    outcome: number;
  };

  @Column({ type: 'text', nullable: true })
  userGoals?: string;

  @Column({ type: 'json', nullable: true })
  sessionMetadata?: {
    userAgent: string;
    deviceType: string;
    inputMethod: string; // 'text' | 'voice' | 'mixed'
    pauseCount: number;
    averageResponseTime: number;
  };

  @Column({ type: 'text', nullable: true })
  userFeedback?: string;

  @Column({ type: 'int', nullable: true })
  userRating?: number; // 1-5 stars

  @Column({ type: 'json', nullable: true })
  completionData?: {
    objectivesAchieved: string[];
    keyMoments: string[];
    improvementAreas: string[];
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relationships
  @ManyToOne(() => User, (user) => user.simulationSessions)
  @JoinColumn()
  user!: User;

  @ManyToOne(() => Simulation, (simulation) => simulation.sessions)
  @JoinColumn()
  simulation!: Simulation;

  @OneToMany(() => SessionMessage, (message) => message.session)
  messages!: SessionMessage[];

  @OneToOne(() => PerformanceAnalytics, (analytics) => analytics.session)
  analytics?: PerformanceAnalytics;

  // Virtual properties and methods
  get isCompleted(): boolean {
    return this.status === SessionStatus.COMPLETED;
  }

  get isInProgress(): boolean {
    return this.status === SessionStatus.IN_PROGRESS || this.status === SessionStatus.STARTED;
  }

  get durationMinutes(): number {
    return Math.round(this.durationSeconds / 60);
  }

  get formattedDuration(): string {
    const minutes = Math.floor(this.durationSeconds / 60);
    const seconds = this.durationSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }

  markAsStarted(): void {
    this.status = SessionStatus.IN_PROGRESS;
    this.startedAt = new Date();
  }

  markAsCompleted(): void {
    this.status = SessionStatus.COMPLETED;
    this.completedAt = new Date();
    if (this.startedAt) {
      this.durationSeconds = Math.floor((this.completedAt.getTime() - this.startedAt.getTime()) / 1000);
    }
  }

  addMessage(): void {
    this.messageCount += 1;
  }

  calculateOverallScore(): number {
    if (!this.scores) return 0;
    
    // Default weights if not specified in simulation
    const weights = {
      communication: 0.3,
      problemSolving: 0.3,
      emotional: 0.2,
      outcome: 0.2,
    };

    return (
      this.scores.communication * weights.communication +
      this.scores.problemSolving * weights.problemSolving +
      this.scores.emotional * weights.emotional +
      this.scores.outcome * weights.outcome
    );
  }
} 