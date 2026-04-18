import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

describe('auth', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('registers a new user and issues a JWT', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'alice@example.com', password: 'super-secret-123' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects duplicate emails with 409', async () => {
    const payload = { email: 'bob@example.com', password: 'super-secret-123' };
    const first = await h.app.inject({ method: 'POST', url: '/auth/register', payload });
    expect(first.statusCode).toBe(201);
    const second = await h.app.inject({ method: 'POST', url: '/auth/register', payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('EMAIL_TAKEN');
  });

  it('validates email format and password length', async () => {
    const bad = await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'short' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('logs in with correct credentials and fails with wrong ones', async () => {
    const payload = { email: 'carol@example.com', password: 'super-secret-123' };
    await h.app.inject({ method: 'POST', url: '/auth/register', payload });

    const ok = await h.app.inject({ method: 'POST', url: '/auth/login', payload });
    expect(ok.statusCode).toBe(200);
    expect(typeof ok.json().token).toBe('string');

    const wrong = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: payload.email, password: 'wrong-password-xyz' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('INVALID_CREDENTIALS');
  });

  it('normalises emails: uppercase input matches a lowercase account', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dan@example.com', password: 'super-secret-123' },
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'DAN@example.com', password: 'super-secret-123' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('/auth/me requires a valid token', async () => {
    const anon = await h.app.inject({ method: 'GET', url: '/auth/me' });
    expect(anon.statusCode).toBe(401);

    const { authHeader } = await registerAndAuth(h.app, 'eve@example.com');
    const me = await h.app.inject({ method: 'GET', url: '/auth/me', headers: authHeader });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('eve@example.com');
  });

  it('rejects a tampered JWT signature', async () => {
    const { token } = await registerAndAuth(h.app, 'frank@example.com');
    const tampered = token.slice(0, -2) + 'xy';
    const res = await h.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
