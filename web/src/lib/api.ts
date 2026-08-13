import type {
  AnalyticsOverview,
  AuthResponse,
  NudgeResponse,
  PendingRegistration,
  Persona,
  SessionDetail,
  SessionReportResponse,
  SessionSummary,
  Simulation,
  SimulationDetail,
  StreamEvent,
  User,
  VoiceEndResponse,
  VoiceStartResponse,
} from './types';
import { readSse } from './sse';

// `NEXT_PUBLIC_API_URL` is the FULL base URL of the api service — version
// path included when the API runs with a prefix, e.g.
// `https://api.careersim.ai/v1`, or just the origin for an unprefixed API
// (`API_VERSION_PREFIX` unset — the bare-container / cloud default).
// Nothing is appended in code, so a Vercel env var alone controls which
// version the frontend talks to. The fallback matches the local rule
// (api/.env and docker-compose.local.yml run the API with
// API_VERSION_PREFIX=v1).
const apiBaseUrl = () =>
  (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/v1').replace(/\/+$/, '');

// Auth is cookie-based: the API sets an httpOnly session cookie at
// login/verify time and every request below rides with
// `credentials: 'include'`. No token is ever stored in JavaScript-
// reachable storage, so an XSS payload cannot exfiltrate credentials.

export class ApiError extends Error {
  status: number;
  code?: string;
  /**
   * Milliseconds until the bucket refills, populated by the server on a
   * `429 RATE_LIMITED` response. Forms can format this into a retry
   * countdown — see `isRateLimitError` / `rateLimitRetryAfterSeconds`.
   */
  retryAfter?: number;
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
    if (
      payload &&
      typeof payload === 'object' &&
      'retryAfter' in payload &&
      typeof (payload as { retryAfter?: unknown }).retryAfter === 'number'
    ) {
      this.retryAfter = (payload as { retryAfter: number }).retryAfter;
    }
  }
}

/** True when `err` is a 429 from the API rate limiter. */
export function isRateLimitError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 429 && err.code === 'RATE_LIMITED';
}

/**
 * Convert an `ApiError.retryAfter` (milliseconds) into a rounded-up
 * number of seconds, clamped to at least 1. Returns null if the field
 * is missing so callers can fall back to the server-rendered message
 * string.
 */
export function rateLimitRetryAfterSeconds(err: ApiError): number | null {
  if (typeof err.retryAfter !== 'number') return null;
  return Math.max(1, Math.ceil(err.retryAfter / 1000));
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers = {} } = opts;

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };

  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: finalHeaders,
    credentials: 'include',
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
    });
  },

  // Note: resend-verification is intentionally ungated on the server
  // (see api/src/modules/auth/auth.schema.ts) so this method doesn't
  // take an ALTCHA payload. The per-mailbox rate limit (3/hour) is the
  // abuse cap, and the pending record it resends against can only be
  // created by `/auth/register`, which *is* captcha-gated.
  async resendVerification(email: string): Promise<void> {
    await request<{ ok: true }>('/auth/resend-verification', {
      method: 'POST',
      body: { email },
    });
  },

  /** Confirm a 6-digit email code and sign in (sets the session cookie). */
  async verifyEmail(email: string, code: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/verify-email', {
      method: 'POST',
      body: { email, code },
    });
  },

  async login(
    email: string,
    password: string,
    altcha?: string,
  ): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: altcha ? { email, password, altcha } : { email, password },
    });
  },

  /** Ask the backend to email a single-use magic-link sign-in URL. */
  async requestEmailLink(email: string, altcha?: string): Promise<void> {
    await request<{ ok: true }>('/auth/login/email-link', {
      method: 'POST',
      body: altcha ? { email, altcha } : { email },
    });
  },

  /** Exchange a magic-link token (from the email URL) for a session. */
  async consumeMagicLink(token: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/magic-link/consume', {
      method: 'POST',
      body: { token },
    });
  },

  async forgotPassword(email: string, altcha?: string): Promise<void> {
    await request<{ ok: true }>('/auth/forgot-password', {
      method: 'POST',
      body: altcha ? { email, altcha } : { email },
    });
  },

  async resetPassword(token: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
    });
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
    return request<AuthResponse>('/auth/me/email-change/confirm', {
      method: 'POST',
      body: { code },
    });
  },

  /** Clear the server-side session cookie. Best-effort: even on network
   *  failure the local state resets and the (expiring) cookie is useless
   *  to anyone who can't read it anyway. */
  async logout(): Promise<void> {
    await request<{ ok: true }>('/auth/logout', { method: 'POST' });
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

  personaAvatarUrl(slugOrUrl: string): string {
    const path = slugOrUrl.startsWith('/')
      ? slugOrUrl
      : `/personas/${encodeURIComponent(slugOrUrl)}/avatar`;
    return `${apiBaseUrl()}${path}`;
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

  async getSession(id: string, signal?: AbortSignal): Promise<SessionDetail> {
    return request<SessionDetail>(`/sessions/${id}`, { signal });
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

  /**
   * Fetch the session debrief report. Served from cache when the
   * transcript hasn't changed; otherwise the API asks the agent to
   * generate a fresh one — expect a few seconds on first load. Rejects
   * with 400 `NO_USER_MESSAGES` when the user hasn't chatted yet.
   */
  async getSessionReport(id: string, signal?: AbortSignal): Promise<SessionReportResponse> {
    return request<SessionReportResponse>(`/sessions/${id}/report`, { signal });
  },

  // ---------- analytics ----------
  async getAnalyticsOverview(signal?: AbortSignal): Promise<AnalyticsOverview> {
    return request<AnalyticsOverview>('/analytics/overview', { signal });
  },

  // ---------- streaming ----------
  /**
   * Send one user message — or a batch of them (the user typed several
   * messages before the persona replied) — and stream the reply. A batch
   * persists each item as its own bubble; the persona composes a single
   * reply to the whole batch.
   */
  streamMessage(
    id: string,
    content: string | string[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, void> {
    return readSse(`${apiBaseUrl()}/sessions/${id}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ content }),
      signal,
    });
  },

  streamFollowup(
    id: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, void> {
    return readSse(`${apiBaseUrl()}/sessions/${id}/proactive/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ trigger_type: 'followup' }),
      signal,
    });
  },

  // ---------- voice ----------

  /**
   * Start a voice call for a session. Returns the LiveKit join token
   * + SFU URL the client uses to connect. May reject with:
   *   - 503 voice_disabled (kill switch)
   *   - 429 voice_quota_exhausted (daily budget used up)
   *   - 403 / 404 (ownership / missing session)
   */
  async startVoiceCall(id: string): Promise<VoiceStartResponse> {
    return request<VoiceStartResponse>(`/sessions/${id}/voice/start`, {
      method: 'POST',
    });
  },

  /**
   * End a voice call and debit the daily quota. Idempotent — safe to
   * call from disconnect / unload paths even if the user already
   * pressed "End call" once. `seconds_used` is server-clamped at 1
   * hour.
   */
  async endVoiceCall(id: string, seconds_used: number): Promise<VoiceEndResponse> {
    return request<VoiceEndResponse>(`/sessions/${id}/voice/end`, {
      method: 'POST',
      body: { seconds_used },
    });
  },
};
