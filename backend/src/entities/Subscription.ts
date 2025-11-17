import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Relation,
} from 'typeorm';
import { User } from './User';
import { SubscriptionTier, SubscriptionStatus, PaymentProvider } from '../types';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
    id!: string;

  @Column({ type: 'uuid' })
    userId!: string;

  @Column({
    type: 'enum',
    enum: SubscriptionTier,
  })
    tier!: SubscriptionTier;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
    status!: SubscriptionStatus;

  @Column({
    type: 'enum',
    enum: PaymentProvider,
    default: PaymentProvider.STRIPE,
  })
    paymentProvider!: PaymentProvider;

  @Column({ type: 'varchar', length: 255, nullable: true })
    externalSubscriptionId?: string; // Stripe subscription ID, PayPal subscription ID, etc.

  @Column({ type: 'varchar', length: 255, nullable: true })
    externalCustomerId?: string; // Stripe customer ID, PayPal customer ID, etc.

  @Column({ type: 'decimal', precision: 10, scale: 2 })
    monthlyPrice!: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
    currency!: string;

  @Column({ type: 'timestamp', nullable: true })
    currentPeriodStart?: Date;

  @Column({ type: 'timestamp', nullable: true })
    currentPeriodEnd?: Date;

  @Column({ type: 'timestamp', nullable: true })
    trialStart?: Date;

  @Column({ type: 'timestamp', nullable: true })
    trialEnd?: Date;

  @Column({ type: 'timestamp', nullable: true })
    canceledAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
    pausedAt?: Date;

  @Column({ type: 'boolean', default: true })
    autoRenew!: boolean;

  @Column({ type: 'int', default: 0 })
    billingCycleCount!: number;

  @Column({ type: 'json', nullable: true })
    metadata?: {
    cancelationReason?: string;
    promoCode?: string;
    referralSource?: string;
    upgradeDate?: string;
    downgradeDate?: string;
  };

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;

  // Relationships
  @OneToOne(() => User, (user) => user.subscription)
  @JoinColumn({ name: 'userId' })
    user!: Relation<User>;

  // Methods
  get isActive(): boolean {
    return this.status === SubscriptionStatus.ACTIVE;
  }

  get isInTrial(): boolean {
    return this.status === SubscriptionStatus.TRIALING;
  }

  get isCanceled(): boolean {
    return this.status === SubscriptionStatus.CANCELED;
  }

  get isPastDue(): boolean {
    return this.status === SubscriptionStatus.PAST_DUE;
  }

  get daysUntilRenewal(): number {
    if (!this.currentPeriodEnd) return 0;
    const now = new Date();
    const timeDiff = this.currentPeriodEnd.getTime() - now.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

  get daysInTrial(): number {
    if (!this.trialStart || !this.trialEnd) return 0;
    const timeDiff = this.trialEnd.getTime() - this.trialStart.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

  get trialDaysRemaining(): number {
    if (!this.trialEnd) return 0;
    const now = new Date();
    const timeDiff = this.trialEnd.getTime() - now.getTime();
    return Math.max(0, Math.ceil(timeDiff / (1000 * 3600 * 24)));
  }

  markAsCanceled(reason?: string): void {
    this.status = SubscriptionStatus.CANCELED;
    this.canceledAt = new Date();
    this.autoRenew = false;
    if (reason) {
      this.metadata = { ...this.metadata, cancelationReason: reason };
    }
  }

  pause(): void {
    this.status = SubscriptionStatus.PAUSED;
    this.pausedAt = new Date();
  }

  resume(): void {
    this.status = SubscriptionStatus.ACTIVE;
    this.pausedAt = undefined;
  }

  upgrade(newTier: SubscriptionTier, newPrice: number): void {
    this.tier = newTier;
    this.monthlyPrice = newPrice;
    this.metadata = { 
      ...this.metadata, 
      upgradeDate: new Date().toISOString(), 
    };
  }

  downgrade(newTier: SubscriptionTier, newPrice: number): void {
    this.tier = newTier;
    this.monthlyPrice = newPrice;
    this.metadata = { 
      ...this.metadata, 
      downgradeDate: new Date().toISOString(), 
    };
  }
} 
