import type {
  AuthResponse,
  NudgeResponse,
  PendingRegistration,
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

  /**
   * Start a signup; the backend emails a 6-digit confirmation code to
   * `email`. Pass `password` to create a password-backed account or omit
   * it to create a passwordless account (the user can set a password
   * later from the profile page).
   */
  async register(
    email: string,
    password?: string,
    altcha?: string,
  ): Promise<PendingRegistration> {
    const base: Record<string, string> = { email };
    if (password) base.password = password;
    if (altcha) base.altcha = altcha;
    return request<PendingRegistration>('/auth/register', {
      method: 'POST',
      body: base,
      auth: false,
    });
  },

  async resendVerification(email: string, altcha?: string): Promise<void> {
    await request<{ ok: true }>('/auth/resend-verification', {
      method: 'POST',
      body: altcha ? { email, altcha } : { email },
      auth: false,
    });
  },

  /** Confirm a 6-digit email code and sign in. */
  async verifyEmail(email: string, code: string): Promise<AuthResponse> {
    const res = await request<AuthResponse>('/auth/verify-email', {
      method: 'POST',
      body: { email, code },
      auth: false,
    });
    setToken(res.token);
    return res;
  },

  async login(
    email: string,
    password: string,
    altcha?: string,
  ): Promise<AuthResponse> {
    const res = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: altcha ? { email, password, altcha } : { email, password },
      auth: false,
    });
    setToken(res.token);
    return res;
  },

  /** Ask the backend to email a single-use magic-link sign-in URL. */
  async requestEmailLink(email: string, altcha?: string): Promise<void> {
    await request<{ ok: true }>('/auth/login/email-link', {
      method: 'POST',
      body: altcha ? { email, altcha } : { email },
      auth: false,
    });
  },

  /** Exchange a magic-link token (from the email URL) for a JWT. */
  async consumeMagicLink(token: string): Promise<AuthResponse> {
    const res = await request<AuthResponse>('/auth/magic-link/consume', {
      method: 'POST',
      body: { token },
      auth: false,
    });
    setToken(res.token);
    return res;
  },

  async forgotPassword(email: string, altcha?: string): Promise<void> {
    await request<{ ok: true }>('/auth/forgot-password', {
      method: 'POST',
      body: altcha ? { email, altcha } : { email },
      auth: false,
    });
  },

  async resetPassword(token: string, password: string): Promise<AuthResponse> {
    const res = await request<AuthResponse>('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
      auth: false,
    });
    setToken(res.token);
    return res;
  },

  async me(): Promise<User> {
    return request<User>('/auth/me');
  },

  async changePassword(
    newPassword: string,
    currentPassword?: string,
  ): Promise<User> {
    const res = await request<{ ok: true; user: User }>('/auth/me/password', {
      method: 'PATCH',
      body: currentPassword
        ? { newPassword, currentPassword }
        : { newPassword },
    });
    return res.user;
  },

  async requestEmailChange(
    newEmail: string,
    currentPassword?: string,
  ): Promise<void> {
    await request<{ ok: true }>('/auth/me/email-change', {
      method: 'POST',
      body: currentPassword ? { newEmail, currentPassword } : { newEmail },
    });
  },

  async confirmEmailChange(code: string): Promise<AuthResponse> {
    const res = await request<AuthResponse>('/auth/me/email-change/confirm', {
      method: 'POST',
      body: { code },
    });
    setToken(res.token);
    return res;
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
