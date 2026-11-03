import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';

import { users } from '../src/db/schema.js';
import fixturePlugin from './fixtures/installed/fixture/index.js';

import { buildTestApp, registerAndAuth, type TestHarness } from './helpers/build-test-app.js';

describe('session revocation', () => {
  let h: TestHarness;
  beforeEach(async () => { h = await buildTestApp({ plugins: [fixturePlugin] }); });
  afterEach(async () => { vi.restoreAllMocks(); await h.close(); });

  it('rejects pre-reset bearer tokens and cookies while accepting the recovery session', async () => {
    const { token, authHeader } = await registerAndAuth(h.app);
    const start = await h.app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: { email: 'alice@example.com' } });
    expect(start.statusCode).toBe(200);
    const resetToken = h.outbox.at(-1)!.text.match(/token=([a-f0-9]+)/)![1];
    const reset = await h.app.inject({ method: 'POST', url: '/v1/auth/reset-password', payload: { token: resetToken, password: 'replacement-password' } });
    expect(reset.statusCode).toBe(200);
    for (const headers of [authHeader, { cookie: `careersim_auth=${token}` }]) {
      expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers })).statusCode).toBe(401);
    }
    const recovered = await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${reset.json().token}` } });
    expect(recovered.statusCode).toBe(200);
  });

  it('revokes only the logged-out session, including copied bearer tokens', async () => {
    const first = await registerAndAuth(h.app);
    const second = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'alice@example.com', password: 'super-secret-123' } });
    expect(second.statusCode).toBe(200);
    expect(second.json().token).not.toBe(first.token);
    const logout = await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie: `careersim_auth=${first.token}` } });
    expect(logout.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: first.authHeader })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${second.json().token}` } })).statusCode).toBe(200);
  });

  it('revokes existing sessions on password change and issues a replacement cookie', async () => {
    const { token, authHeader } = await registerAndAuth(h.app);
    const change = await h.app.inject({ method: 'PATCH', url: '/v1/auth/me/password', headers: authHeader, payload: { currentPassword: 'super-secret-123', newPassword: 'replacement-password' } });
    expect(change.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: authHeader })).statusCode).toBe(401);
    const cookie = String(change.headers['set-cookie']).split(';')[0]!;
    expect(cookie).not.toBe(`careersim_auth=${token}`);
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } })).statusCode).toBe(200);
  });

  it('rejects legacy signed tokens without a revocable session', async () => {
    const { userId } = await registerAndAuth(h.app);
    const legacy = h.app.jwt.sign({ sub: userId, email: 'alice@example.com' } as Parameters<typeof h.app.jwt.sign>[0]);
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${legacy}` } })).statusCode).toBe(401);
  });

  it('rejects tokens issued after reset when login verified the old credentials before reset', async () => {
    const { userId, authHeader } = await registerAndAuth(h.app);
    const [beforeReset] = await h.db.db.select().from(users).where(eq(users.id, userId));
    const change = await h.app.inject({ method: 'PATCH', url: '/v1/auth/me/password', headers: authHeader, payload: { currentPassword: 'super-secret-123', newPassword: 'replacement-password' } });
    expect(change.statusCode).toBe(200);
    const lateToken = await h.app.issueSessionToken(beforeReset!);
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${lateToken}` } })).statusCode).toBe(401);
  });

  it('does not resolve private simulation identity from a logged-out token', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const before = await h.app.inject({ url: '/v1/simulations/fixture:private', headers: authHeader });
    expect(before.statusCode).toBe(200);
    await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: authHeader });
    expect((await h.app.inject({ url: '/v1/simulations/fixture:private', headers: authHeader })).statusCode).toBe(404);
  });

  it('does not let an in-flight password change overwrite a completed password reset', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    let resume!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const verify = argon2.verify;
    vi.spyOn(argon2, 'verify').mockImplementation(async (...args) => {
      const result = await verify(...args);
      if (args[1] === 'super-secret-123') { reached(); await gate; }
      return result;
    });
    const stale = h.app.inject({ method: 'PATCH', url: '/v1/auth/me/password', headers: authHeader, payload: { currentPassword: 'super-secret-123', newPassword: 'stale-request-password' } }).then((response) => response);
    try {
      await paused;
      await h.app.inject({ method: 'POST', url: '/v1/auth/forgot-password', payload: { email: 'alice@example.com' } });
      const resetToken = h.outbox.at(-1)!.text.match(/token=([a-f0-9]+)/)![1];
      const reset = await h.app.inject({ method: 'POST', url: '/v1/auth/reset-password', payload: { token: resetToken, password: 'recovered-password' } });
      expect(reset.statusCode).toBe(200);
      resume();
      expect((await stale).statusCode).toBe(401);
      const login = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'alice@example.com', password: 'recovered-password' } });
      expect(login.statusCode).toBe(200);
    } finally { resume(); await stale; }
  });

  it('does not report successful logout when the session store is unavailable', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    vi.spyOn(h.db.db, 'select').mockImplementation(() => { throw new Error('database unavailable'); });
    const response = await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: authHeader });
    expect(response.statusCode).toBe(500);
  });
});
