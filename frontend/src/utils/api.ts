import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
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
  PaginatedResponse,
} from '../types';

class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000/api',
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
    } else if (error.response?.status >= 500) {
      toast.error('Server error. Please try again later.');
    } else if (error.response?.data?.error) {
      toast.error(error.response.data.error);
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
  }): Promise<PaginatedResponse<Simulation>> {
    const response = await this.client.get<PaginatedResponse<Simulation>>('/simulations', { params });
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

  // Sessions API
  public async getSessions(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResponse<SimulationSession>> {
    const response = await this.client.get<PaginatedResponse<SimulationSession>>('/sessions', { params });
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

  public async sendMessage(sessionId: string, content: string): Promise<SessionMessage> {
    const response = await this.client.post<{ message: SessionMessage }>(
      `/sessions/${sessionId}/messages`,
      { content }
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
}

export const apiClient = new ApiClient(); 