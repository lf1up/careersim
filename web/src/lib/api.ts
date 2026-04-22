import type {
  AuthResponse,
  NudgeResponse,
  Persona,
  SessionDetail,
  SessionSummary,
  Simulation,
  SimulationDetail,
  StreamEvent,
  User,
} from './types';
import { readSse } from './sse';

const TOKEN_STORAGE_KEY = 'careersim.authToken';

const apiBaseUrl = () =>
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8000';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  payload?: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
    if (
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
    ) {
      this.code = (payload as { error: string }).error;
    }
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, auth = true, headers = {} } = opts;

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };

  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  if (auth) {
    const token = getToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    let message: string | undefined;
    if (
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof (payload as { message?: unknown }).message === 'string'
    ) {
      message = (payload as { message: string }).message;
    }
    throw new ApiError(
      response.status,
      message || response.statusText || `HTTP ${response.status}`,
      payload,
    );
  }

  return payload as T;
}

export const apiClient = {
  // ---------- auth ----------
  async register(email: string, password: string): Promise<AuthResponse> {
    const res = await request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    setToken(res.token);
    return res;
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const res = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    setToken(res.token);
    return res;
  },

  async me(): Promise<User> {
    return request<User>('/auth/me');
  },

  logout(): void {
    clearToken();
  },

  // ---------- simulations ----------
  async listSimulations(): Promise<Simulation[]> {
    const res = await request<{ simulations: Simulation[] }>('/simulations');
    return res.simulations;
  },

  async getSimulation(slug: string): Promise<SimulationDetail> {
    return request<SimulationDetail>(
      `/simulations/${encodeURIComponent(slug)}`,
    );
  },

  // ---------- personas ----------
  async listPersonas(): Promise<Persona[]> {
    const res = await request<{ personas: Persona[] }>('/personas');
    return res.personas;
  },

  // ---------- sessions ----------
  async createSession(simulationSlug: string): Promise<SessionDetail> {
    return request<SessionDetail>('/sessions', {
      method: 'POST',
      body: { simulation_slug: simulationSlug },
    });
  },

  async listSessions(): Promise<SessionSummary[]> {
    const res = await request<{ sessions: SessionSummary[] }>('/sessions');
    return res.sessions;
  },

  async getSession(id: string): Promise<SessionDetail> {
    return request<SessionDetail>(`/sessions/${id}`);
  },

  async postMessage(id: string, content: string): Promise<SessionDetail> {
    return request<SessionDetail>(`/sessions/${id}/messages`, {
      method: 'POST',
      body: { content },
    });
  },

  async triggerFollowup(id: string): Promise<SessionDetail> {
    return request<SessionDetail>(`/sessions/${id}/proactive`, {
      method: 'POST',
      body: { trigger_type: 'followup' },
    });
  },

  async nudge(id: string): Promise<NudgeResponse> {
    return request<NudgeResponse>(`/sessions/${id}/nudge`, { method: 'POST' });
  },

  // ---------- streaming ----------
  streamMessage(
    id: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, void> {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return readSse(`${apiBaseUrl()}/sessions/${id}/messages/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content }),
      signal,
    });
  },

  streamFollowup(
    id: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, void> {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return readSse(`${apiBaseUrl()}/sessions/${id}/proactive/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ trigger_type: 'followup' }),
      signal,
    });
  },
};

export { getToken };
