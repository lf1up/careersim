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

/**
 * @swagger
 * components:
 *   schemas:
 *     SessionMessage:
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
 *         sequenceNumber:
 *           type: integer
 *           minimum: 1
 *           example: 3
 *         type:
 *           type: string
 *           enum: [user, ai, system]
 *           example: "user"
 *         content:
 *           type: string
 *           example: "I'm interested in the software engineer position."
 *         inputMethod:
 *           type: string
 *           enum: [text, voice]
 *           nullable: true
 *           example: "text"
 *         metadata:
 *           type: object
 *           nullable: true
 *           properties:
 *             confidence:
 *               type: number
 *               example: 0.95
 *             processingTime:
 *               type: number
 *               example: 1.2
 *             emotionalTone:
 *               type: string
 *               example: "confident"
 *             sentiment:
 *               type: string
 *               enum: [positive, neutral, negative]
 *               example: "positive"
 *             keyPhrases:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["software engineer", "experience"]
 *             responseToMessageId:
 *               type: string
 *               example: "123e4567-e89b-12d3-a456-426614174000"
 *         timestamp:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         isHighlighted:
 *           type: boolean
 *           example: false
 *         highlightReason:
 *           type: string
 *           nullable: true
 *           example: "Strong technical response"
 *         analysisData:
 *           type: object
 *           nullable: true
 *           properties:
 *             wordCount:
 *               type: number
 *               example: 25
 *             sentenceCount:
 *               type: number
 *               example: 3
 *             averageWordsPerSentence:
 *               type: number
 *               example: 8.3
 *             complexityScore:
 *               type: number
 *               example: 7.2
 *             fillerWords:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["um", "like"]
 *             powerWords:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["achieved", "implemented"]
 *             questionCount:
 *               type: number
 *               example: 1
 *             statementCount:
 *               type: number
 *               example: 2
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         session:
 *           $ref: '#/components/schemas/SimulationSession'
 *         isFromUser:
 *           type: boolean
 *           example: true
 *         isFromAI:
 *           type: boolean
 *           example: false
 *         wordCount:
 *           type: number
 *           example: 25
 *         hasEmotionalTone:
 *           type: boolean
 *           example: true
 */

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