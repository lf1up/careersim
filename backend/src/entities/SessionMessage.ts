import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SimulationSession } from './SimulationSession';

export enum MessageType {
  USER = 'user',
  AI = 'ai',
  SYSTEM = 'system',
}

export enum MessageInputMethod {
  TEXT = 'text',
  VOICE = 'voice',
}

@Entity('session_messages')
@Index(['sessionId', 'sequenceNumber'])
export class SessionMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'int' })
  sequenceNumber!: number;

  @Column({
    type: 'enum',
    enum: MessageType,
  })
  type!: MessageType;

  @Column({ type: 'text' })
  content!: string;

  @Column({
    type: 'enum',
    enum: MessageInputMethod,
    nullable: true,
  })
  inputMethod?: MessageInputMethod;

  @Column({ type: 'json', nullable: true })
  metadata?: {
    confidence?: number; // For voice-to-text confidence
    processingTime?: number; // AI response generation time
    emotionalTone?: string;
    sentiment?: 'positive' | 'neutral' | 'negative';
    keyPhrases?: string[];
    responseToMessageId?: string;
  };

  @Column({ type: 'timestamp', nullable: true })
  timestamp!: Date;

  @Column({ type: 'boolean', default: false })
  isHighlighted!: boolean;

  @Column({ type: 'text', nullable: true })
  highlightReason?: string;

  @Column({ type: 'json', nullable: true })
  analysisData?: {
    wordCount: number;
    sentenceCount: number;
    averageWordsPerSentence: number;
    complexityScore: number;
    fillerWords: string[];
    powerWords: string[];
    questionCount: number;
    statementCount: number;
  };

  @CreateDateColumn()
  createdAt!: Date;

  // Relationships
  @ManyToOne(() => SimulationSession, (session) => session.messages)
  @JoinColumn({ name: 'sessionId' })
  session!: SimulationSession;

  // Methods
  get isFromUser(): boolean {
    return this.type === MessageType.USER;
  }

  get isFromAI(): boolean {
    return this.type === MessageType.AI;
  }

  get wordCount(): number {
    return this.content.trim().split(/\s+/).length;
  }

  get hasEmotionalTone(): boolean {
    return !!(this.metadata?.emotionalTone);
  }

  markAsHighlighted(reason: string): void {
    this.isHighlighted = true;
    this.highlightReason = reason;
  }
} 