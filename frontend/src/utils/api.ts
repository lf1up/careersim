import axios, { AxiosInstance, AxiosError } from 'axios';
import toast from 'react-hot-toast';
import {
  User,
  LoginCredentials,
  RegisterData,
  AuthResponse,
  Simulation,
  Category,
  Persona,
  SimulationSession,
  SessionMessage,
  PerformanceAnalytics,
  Subscription,
  PaginationResponse,
} from '../types';

class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: (process.env.REACT_APP_API_URL as string) || 'http://localhost:8000/api',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      (config) => {
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        this.handleApiError(error);
        return Promise.reject(error);
      }
    );

    // Initialize token from localStorage
    this.initializeToken();
  }

  private initializeToken(): void {
    const savedToken = localStorage.getItem('authToken');
    if (savedToken) {
      this.setToken(savedToken);
    }
  }

  public setToken(token: string): void {
    this.token = token;
    localStorage.setItem('authToken', token);
  }

  public clearToken(): void {
    this.token = null;
    localStorage.removeItem('authToken');
  }

  private handleApiError(error: AxiosError): void {
    if (error.response?.status === 401) {
      this.clearToken();
      window.location.href = '/login';
      toast.error('Session expired. Please log in again.');
    } else if (error.response?.status === 403) {
      toast.error('You do not have permission to perform this action.');
    } else if (error.response?.status && error.response.status >= 500) {
      toast.error('Server error. Please try again later.');
    } else if (error.response?.data && typeof error.response.data === 'object' && 'error' in error.response.data) {
      toast.error((error.response.data as any).error);
    } else if (error.message) {
      toast.error(error.message);
    }
  }

  // Authentication API
  public async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/login', credentials);
    this.setToken(response.data.tokens.accessToken);
    return response.data;
  }

  public async register(data: RegisterData): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/register', data);
    this.setToken(response.data.tokens.accessToken);
    return response.data;
  }

  public async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout');
    } finally {
      this.clearToken();
    }
  }

  public async forgotPassword(email: string): Promise<void> {
    await this.client.post('/auth/forgot-password', { email });
  }

  public async resetPassword(token: string, password: string): Promise<void> {
    await this.client.post('/auth/reset-password', { token, password });
  }

  public async refreshToken(): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/refresh');
    this.setToken(response.data.tokens.accessToken);
    return response.data;
  }

  // User API
  public async getUserProfile(): Promise<User> {
    const response = await this.client.get<{ user: User }>('/users/profile');
    return response.data.user;
  }

  public async updateUserProfile(data: Partial<User>): Promise<User> {
    const response = await this.client.patch<{ user: User }>('/users/profile', data);
    return response.data.user;
  }

  // Simulations API
  public async getSimulations(params?: {
    page?: number;
    limit?: number;
    category?: string;
    difficulty?: string;
  }): Promise<{ simulations: Simulation[]; pagination: any }> {
    const response = await this.client.get<{ simulations: Simulation[]; pagination: any }>('/simulations', { params });
    return response.data;
  }

  public async getSimulation(id: string): Promise<Simulation> {
    const response = await this.client.get<{ simulation: Simulation }>(`/simulations/${id}`);
    return response.data.simulation;
  }

  // Categories API
  public async getCategories(): Promise<Category[]> {
    const response = await this.client.get<{ categories: Category[] }>('/categories');
    return response.data.categories;
  }

  // Personas API
  public async getPersonas(): Promise<Persona[]> {
    const response = await this.client.get<{ personas: Persona[] }>('/personas');
    return response.data.personas;
  }

  // Admin Personas API
  public async getAdminPersonas(params?: {
    page?: number;
    limit?: number;
    category?: string;
    search?: string;
    active?: boolean;
  }): Promise<{ personas: Persona[]; pagination: PaginationResponse }> {
    const response = await this.client.get<{ personas: Persona[]; pagination: PaginationResponse }>('/admin/personas', { params });
    return response.data;
  }

  public async getAdminPersona(id: string): Promise<{ persona: Persona; stats: { totalSimulations: number; totalSessions: number; avgScore: number } }> {
    const response = await this.client.get<{ persona: Persona; stats: { totalSimulations: number; totalSessions: number; avgScore: number } }>(`/admin/personas/${id}`);
    return response.data;
  }

  public async createPersona(data: Partial<Persona>): Promise<Persona> {
    const response = await this.client.post<{ persona: Persona }>('/admin/personas', data);
    return response.data.persona;
  }

  public async updatePersona(id: string, data: Partial<Persona>): Promise<Persona> {
    const response = await this.client.patch<{ persona: Persona }>(`/admin/personas/${id}`, data);
    return response.data.persona;
  }

  public async deletePersona(id: string): Promise<void> {
    await this.client.delete(`/admin/personas/${id}`);
  }

  // Admin Simulations API
  public async getAdminSimulation(id: string): Promise<{ simulation: Simulation; stats: { totalSessions: number; completedSessions: number; avgScore: number } }> {
    const response = await this.client.get<{ simulation: Simulation; stats: { totalSessions: number; completedSessions: number; avgScore: number } }>(`/admin/simulations/${id}`);
    return response.data;
  }

  public async updateSimulation(id: string, data: Partial<Simulation>): Promise<Simulation> {
    const response = await this.client.patch<{ simulation: Simulation }>(`/admin/simulations/${id}`, data);
    return response.data.simulation;
  }

  public async deleteSimulation(id: string): Promise<void> {
    await this.client.delete(`/admin/simulations/${id}`);
  }

  // Simulation-Persona relationship management
  public async getSimulationPersonas(simulationId: string): Promise<Persona[]> {
    const response = await this.client.get<{ personas: Persona[] }>(`/admin/simulations/${simulationId}/personas`);
    return response.data.personas;
  }

  public async updateSimulationPersonas(simulationId: string, personaIds: string[]): Promise<{ message: string; personas: Persona[] }> {
    const response = await this.client.put<{ message: string; personas: Persona[] }>(`/admin/simulations/${simulationId}/personas`, { personaIds });
    return response.data;
  }

  public async addPersonaToSimulation(simulationId: string, personaId: string): Promise<{ message: string; personas: Persona[] }> {
    const response = await this.client.post<{ message: string; personas: Persona[] }>(`/admin/simulations/${simulationId}/personas/${personaId}`);
    return response.data;
  }

  public async removePersonaFromSimulation(simulationId: string, personaId: string): Promise<{ message: string; personas: Persona[] }> {
    const response = await this.client.delete<{ message: string; personas: Persona[] }>(`/admin/simulations/${simulationId}/personas/${personaId}`);
    return response.data;
  }

  // Sessions API
  public async getSessions(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<{ sessions: SimulationSession[]; pagination: any }> {
    const response = await this.client.get<{ sessions: SimulationSession[]; pagination: any }>('/sessions', { params });
    return response.data;
  }

  public async getSession(id: string): Promise<SimulationSession> {
    const response = await this.client.get<{ session: SimulationSession }>(`/sessions/${id}`);
    return response.data.session;
  }

  public async startSession(simulationId: string): Promise<SimulationSession> {
    const response = await this.client.post<{ session: SimulationSession }>('/sessions', {
      simulationId,
    });
    return response.data.session;
  }

  public async sendMessage(sessionId: string, content: string, simulationId?: string): Promise<SessionMessage> {
    // If simulationId is not provided, we need to get it from the session
    let simId = simulationId;
    if (!simId) {
      // Get session details to find simulation ID
      const session = await this.getSession(sessionId);
      simId = session.simulation.id;
    }
    
    const response = await this.client.post<{ message: SessionMessage }>(
      `/simulations/${simId}/sessions/${sessionId}/messages`,
      { 
        content,
        type: 'user'  // User messages are always type 'user'
      }
    );
    return response.data.message;
  }

  public async updateSessionStatus(sessionId: string, status: string): Promise<SimulationSession> {
    const response = await this.client.patch<{ session: SimulationSession }>(
      `/sessions/${sessionId}/status`,
      { status }
    );
    return response.data.session;
  }

  public async getSessionMessages(simulationId: string, sessionId: string, params?: {
    page?: number;
    limit?: number;
  }): Promise<{ messages: SessionMessage[]; pagination: any }> {
    const response = await this.client.get<{ messages: SessionMessage[]; pagination: any }>(
      `/simulations/${simulationId}/sessions/${sessionId}/messages`,
      { params }
    );
    return response.data;
  }

  // Analytics API
  public async getPerformanceAnalytics(): Promise<PerformanceAnalytics> {
    const response = await this.client.get<PerformanceAnalytics>('/analytics/performance');
    return response.data;
  }

  // Subscriptions API
  public async getCurrentSubscription(): Promise<Subscription | null> {
    try {
      const response = await this.client.get<{ subscription: Subscription }>('/subscriptions/current');
      return response.data.subscription;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  public async upgradeSubscription(tier: string): Promise<Subscription> {
    const response = await this.client.post<{ subscription: Subscription }>('/subscriptions/upgrade', {
      tier,
    });
    return response.data.subscription;
  }

  // Admin API
  public async getAdminDashboard(): Promise<{
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
  }> {
    const response = await this.client.get('/admin/dashboard');
    return response.data;
  }

  public async getAdminUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    tier?: string;
    status?: string;
  }): Promise<{
    users: User[];
    pagination: {
      current: number;
      total: number;
      count: number;
      limit: number;
    };
  }> {
    const response = await this.client.get('/admin/users', { params });
    return response.data;
  }

  public async getAdminUser(id: string): Promise<{
    user: User;
    recentSessions: SimulationSession[];
    stats: {
      totalSessions: number;
      completedSessions: number;
    };
  }> {
    const response = await this.client.get(`/admin/users/${id}`);
    return response.data;
  }

  public async updateAdminUser(id: string, data: {
    role?: string;
    subscriptionTier?: string;
    isActive?: boolean;
  }): Promise<{ user: User }> {
    const response = await this.client.patch(`/admin/users/${id}`, data);
    return response.data;
  }

  public async getAdminSimulations(params?: {
    page?: number;
    limit?: number;
    status?: string;
    category?: string;
  }): Promise<{
    simulations: Simulation[];
    pagination: {
      current: number;
      total: number;
      count: number;
      limit: number;
    };
  }> {
    const response = await this.client.get('/admin/simulations', { params });
    return response.data;
  }

  public async getAdminAnalytics(): Promise<{
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
  }> {
    const response = await this.client.get('/admin/analytics');
    return response.data;
  }

  public async exportAdminUsers(): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    subscriptionTier: string;
    isActive: boolean;
    createdAt: string;
  }[]> {
    const response = await this.client.get('/admin/export/users');
    return response.data;
  }

  public async exportAdminSessions(): Promise<{
    id: string;
    status: string;
    durationSeconds: number;
    overallScore: number;
    createdAt: string;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
    simulation: {
      id: string;
      title: string;
    };
  }[]> {
    const response = await this.client.get('/admin/export/sessions');
    return response.data;
  }

  // System Configuration methods
  public async getSystemConfig(): Promise<{
    configurations: any[];
    aiSettings: {
      model: string;
      maxTokens: number;
      temperature: number;
      frequencyPenalty: number;
      presencePenalty: number;
      topP: number;
    };
    systemPrompts: {
      baseSystemPrompt: string;
      performanceAnalysisPrompt: string;
    };
    rateLimitSettings: {
      windowMs: number;
      maxRequests: number;
      enabled: boolean;
    };
  }> {
    const response = await this.client.get('/admin/system/config');
    return response.data;
  }

  public async updateAISettings(settings: {
    model: string;
    maxTokens: number;
    temperature: number;
    frequencyPenalty: number;
    presencePenalty: number;
    topP: number;
  }): Promise<{ message: string; configuration: any }> {
    const response = await this.client.put('/admin/system/config/ai', settings);
    return response.data;
  }

  public async updateSystemPrompts(prompts: {
    baseSystemPrompt: string;
    performanceAnalysisPrompt: string;
  }): Promise<{ message: string; configuration: any }> {
    const response = await this.client.put('/admin/system/config/prompts', prompts);
    return response.data;
  }


}

export const apiClient = new ApiClient(); 