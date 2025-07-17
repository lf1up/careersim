import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SimulationSession } from './SimulationSession';
import { Subscription } from './Subscription';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
}

export enum SubscriptionTier {
  FREEMIUM = 'freemium',
  PRO = 'pro',
  PREMIUM = 'premium',
}

@Entity('users')
@Index(['email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  firstName!: string;

  @Column({ type: 'varchar', length: 255 })
  lastName!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  password!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role!: UserRole;

  @Column({
    type: 'enum',
    enum: SubscriptionTier,
    default: SubscriptionTier.FREEMIUM,
  })
  subscriptionTier!: SubscriptionTier;

  @Column({ type: 'boolean', default: false })
  isEmailVerified!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  emailVerificationToken?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordResetToken?: string;

  @Column({ type: 'timestamp', nullable: true })
  passwordResetExpires?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  profileImageUrl?: string;

  @Column({ type: 'text', nullable: true })
  bio?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  jobTitle?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  company?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  industry?: string;

  @Column({ type: 'int', default: 0 })
  totalSimulationsCompleted!: number;

  @Column({ type: 'int', default: 0 })
  monthlySimulationsUsed!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastSimulationDate?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt?: Date;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relationships
  @OneToMany(() => SimulationSession, (session) => session.user)
  simulationSessions!: SimulationSession[];

  @OneToOne(() => Subscription, (subscription) => subscription.user)
  @JoinColumn()
  subscription?: Subscription;

  // Methods
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  get isFreemium(): boolean {
    return this.subscriptionTier === SubscriptionTier.FREEMIUM;
  }

  get isPro(): boolean {
    return this.subscriptionTier === SubscriptionTier.PRO;
  }

  get isPremium(): boolean {
    return this.subscriptionTier === SubscriptionTier.PREMIUM;
  }

  get hasUnlimitedAccess(): boolean {
    return this.subscriptionTier === SubscriptionTier.PRO || this.subscriptionTier === SubscriptionTier.PREMIUM;
  }

  canAccessSimulation(): boolean {
    if (this.hasUnlimitedAccess) {
      return true;
    }
    
    // Freemium users get 3 simulations per month
    const FREEMIUM_MONTHLY_LIMIT = 3;
    return this.monthlySimulationsUsed < FREEMIUM_MONTHLY_LIMIT;
  }

  incrementSimulationUsage(): void {
    this.monthlySimulationsUsed += 1;
    this.totalSimulationsCompleted += 1;
    this.lastSimulationDate = new Date();
  }

  resetMonthlyUsage(): void {
    this.monthlySimulationsUsed = 0;
  }
} 