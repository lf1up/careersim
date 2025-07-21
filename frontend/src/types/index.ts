// Enums matching backend
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

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  PAUSED = 'paused',
  TRIALING = 'trialing',
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

export enum SessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  PAUSED = 'paused',
}

// User interfaces
export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  subscriptionTier: SubscriptionTier;
  isEmailVerified: boolean;
  isActive: boolean;
  profilePictureUrl?: string;
  bio?: string;
  location?: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Auth interfaces
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
  message?: string;
}

// Simulation interfaces
export interface Category {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  color?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Persona {
  id: string;
  name: string;
  title: string;
  company: string;
  description: string;
  avatarUrl?: string;
  personality: string;
  communicationStyle: string;
  decisionMakingStyle: string;
  stressLevel: number;
  experience: number;
  industry: string;
  createdAt: string;
  updatedAt: string;
}

export interface Simulation {
  id: string;
  title: string;
  slug: string;
  description: string;
  objectives: string[];
  scenario: string;
  difficulty: SimulationDifficulty;
  estimatedDurationMinutes: number;
  status: SimulationStatus;
  thumbnailUrl?: string;
  tags: string[];
  isPublic: boolean;
  viewCount: number;
  completionCount: number;
  averageRating: number;
  category: Category;
  personas: Persona[];
  createdAt: string;
  updatedAt: string;
}

// Session interfaces
export interface SessionMessage {
  id: string;
  content: string;
  isFromUser: boolean;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface SimulationSession {
  id: string;
  status: SessionStatus;
  startedAt: string;
  completedAt?: string;
  pausedAt?: string;
  totalDuration: number;
  currentStep: number;
  totalSteps: number;
  metadata: Record<string, any>;
  simulation: Simulation;
  messages: SessionMessage[];
  createdAt: string;
  updatedAt: string;
}

// Analytics interfaces
export interface PerformanceStats {
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
}

export interface AverageScores {
  avgOverall: number;
  avgCommunication: number;
  avgProblemSolving: number;
  avgLeadership: number;
  avgTechnical: number;
}

export interface PerformanceAnalytics {
  stats: PerformanceStats;
  averageScores: AverageScores;
}

// Subscription interfaces
export interface Subscription {
  id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  startDate: string;
  endDate?: string;
  autoRenew: boolean;
  paymentProvider: string;
  pricePerMonth: number;
  features: string[];
  user: User;
  createdAt: string;
  updatedAt: string;
}

// API Response interfaces
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// UI State interfaces
export interface LoadingState {
  [key: string]: boolean;
}

export interface ErrorState {
  [key: string]: string | null;
}

// Admin interfaces
export interface AdminDashboardStats {
  overview: {
    totalUsers: number;
    activeUsers: number;
    totalSimulations: number;
    publishedSimulations: number;
    totalSessions: number;
    completedSessions: number;
    totalSubscriptions: number;
    activeSubscriptions: number;
  };
  userGrowth: { date: string; count: number }[];
  topSimulations: { title: string; id: string; total_sessions: number; completed_sessions: number }[];
}

export interface AdminUserDetails {
  user: User;
  recentSessions: SimulationSession[];
  stats: {
    totalSessions: number;
    completedSessions: number;
  };
}

export interface AdminUserUpdate {
  role?: UserRole;
  subscriptionTier?: SubscriptionTier;
  isActive?: boolean;
}

export interface AdminAnalytics {
  userStats: {
    totalUsers: number;
    activeUsers: number;
    avgSimulationsPerUser: number;
  };
  sessionStats: {
    totalSessions: number;
    avgDuration: number;
    avgScore: number;
    completedSessions: number;
  };
  popularSimulations: {
    title: string;
    id: string;
    sessionCount: number;
    avgScore: number;
  }[];
}

export interface AdminFilters {
  users: {
    search?: string;
    tier?: SubscriptionTier;
    status?: 'active' | 'inactive';
    page?: number;
    limit?: number;
  };
  simulations: {
    status?: SimulationStatus;
    category?: string;
    page?: number;
    limit?: number;
  };
} 