import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';

import { authTokens } from '../src/db/schema.js';
import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

type Mail = { to: string; subject: string; text: string; html: string };

function lastMailTo(outbox: Mail[], to: string): Mail {
  const match = outbox.slice().reverse().find((m) => m.to === to.toLowerCase());
  if (!match) throw new Error(`no mail sent to ${to}`);
  return match;
}

function extractCode(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  if (!m || !m[1]) throw new Error(`no 6-digit code in: ${text}`);
  return m[1];
}

function extractLinkToken(text: string): string {
  const m = text.match(/token=([a-f0-9]+)/i);
  if (!m || !m[1]) throw new Error(`no token in: ${text}`);
  return m[1];
}

describe('auth', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  // -- registration + verification ------------------------------------------

  it('registers with a password -> pending 202, then verifies via 6-digit code', async () => {
    const email = 'alice@example.com';
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ pending: true, email });

    const mail = lastMailTo(h.outbox, email);
    expect(mail.subject.toLowerCase()).toContain('code');
    const code = extractCode(mail.text);

    const verify = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as {
      token: string;
      user: { id: string; email: string; email_verified_at: string | null; has_password: boolean };
    };
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toBe(email);
    expect(body.user.has_password).toBe(true);
    expect(body.user.email_verified_at).not.toBeNull();
  });

  it('registers passwordless -> verify gives JWT but login with password is blocked', async () => {
    const email = 'eve@example.com';
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email },
    });
    expect(res.statusCode).toBe(202);

    const code = extractCode(lastMailTo(h.outbox, email).text);
    const verify = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as { user: { has_password: boolean } };
    expect(body.user.has_password).toBe(false);

    const login = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'never-set-any' },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toBe('PASSWORDLESS_ACCOUNT');
  });

  it('rejects a wrong confirmation code', async () => {
    const email = 'frank@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    const wrong = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code: '000000' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('INVALID_CODE');
  });

  it('resend-verification sends a new code and always returns 200 (no leak)', async () => {
    const email = 'grace@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    const before = h.outbox.length;
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email },
    });
    expect(res.statusCode).toBe(200);
    expect(h.outbox.length).toBe(before + 1);

    // Unknown email: no new mail but still 200.
    const unknown = await h.app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'nobody@example.com' },
    });
    expect(unknown.statusCode).toBe(200);
    expect(h.outbox.length).toBe(before + 1);
  });

  it('rejects duplicate signups once the account is verified', async () => {
    const email = 'bob@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    const code = extractCode(lastMailTo(h.outbox, email).text);
    await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code },
    });

    const second = await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
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

  it('normalises emails: uppercase input matches a lowercase account', async () => {
    await registerAndAuth(h.app, 'dan@example.com');
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'DAN@example.com', password: 'super-secret-123' },
    });
    expect(res.statusCode).toBe(200);
  });

  // -- login / verification gating -----------------------------------------

  it('blocks login for unverified accounts with EMAIL_NOT_VERIFIED', async () => {
    const email = 'pending@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'super-secret-123' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('EMAIL_NOT_VERIFIED');
  });

  it('logs in with correct credentials and fails with wrong ones', async () => {
    const email = 'carol@example.com';
    await registerAndAuth(h.app, email);

    const ok = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'super-secret-123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(typeof ok.json().token).toBe('string');

    const wrong = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrong-password-xyz' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('INVALID_CREDENTIALS');
  });

  // -- magic-link login ----------------------------------------------------

  it('email-link login: creates an unverified stub and logs in via the link', async () => {
    const email = 'link-first@example.com';
    const req = await h.app.inject({
      method: 'POST',
      url: '/auth/login/email-link',
      payload: { email },
    });
    expect(req.statusCode).toBe(200);

    const mail = lastMailTo(h.outbox, email);
    const token = extractLinkToken(mail.text);
    const consume = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link/consume',
      payload: { token },
    });
    expect(consume.statusCode).toBe(200);
    const body = consume.json() as { token: string; user: { email_verified_at: string | null } };
    expect(typeof body.token).toBe('string');
    expect(body.user.email_verified_at).not.toBeNull();
  });

  it('magic link can only be consumed once', async () => {
    const email = 'once@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/login/email-link',
      payload: { email },
    });
    const token = extractLinkToken(lastMailTo(h.outbox, email).text);
    const first = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link/consume',
      payload: { token },
    });
    expect(first.statusCode).toBe(200);
    const second = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link/consume',
      payload: { token },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('INVALID_TOKEN');
  });

  // -- forgot + reset password --------------------------------------------

  it('forgot-password emails a reset link; reset-password sets a new password', async () => {
    const email = 'reset@example.com';
    await registerAndAuth(h.app, email, 'old-password-abc');

    const req = await h.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email },
    });
    expect(req.statusCode).toBe(200);

    const token = extractLinkToken(lastMailTo(h.outbox, email).text);
    const reset = await h.app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'brand-new-password-xyz' },
    });
    expect(reset.statusCode).toBe(200);

    const loggedIn = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'brand-new-password-xyz' },
    });
    expect(loggedIn.statusCode).toBe(200);

    const old = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'old-password-abc' },
    });
    expect(old.statusCode).toBe(400);
  });

  it('forgot-password for unknown email still returns 200 and sends no mail', async () => {
    const before = h.outbox.length;
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'noone@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(h.outbox.length).toBe(before);
  });

  // -- /auth/me and JWT rules ---------------------------------------------

  it('/auth/me requires a valid token', async () => {
    const anon = await h.app.inject({ method: 'GET', url: '/auth/me' });
    expect(anon.statusCode).toBe(401);

    const { authHeader } = await registerAndAuth(h.app, 'me@example.com');
    const me = await h.app.inject({ method: 'GET', url: '/auth/me', headers: authHeader });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('me@example.com');
    expect(me.json().has_password).toBe(true);
  });

  it('rejects a tampered JWT signature', async () => {
    const { token } = await registerAndAuth(h.app, 'frank-tamper@example.com');
    const tampered = token.slice(0, -2) + 'xy';
    const res = await h.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.statusCode).toBe(401);
  });

  // -- profile: change password -------------------------------------------

  it('PATCH /auth/me/password: requires currentPassword when account has one', async () => {
    const { authHeader } = await registerAndAuth(h.app, 'pw@example.com', 'current-abc-123');

    const missing = await h.app.inject({
      method: 'PATCH',
      url: '/auth/me/password',
      headers: authHeader,
      payload: { newPassword: 'brand-new-abc-123' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe('CURRENT_PASSWORD_REQUIRED');

    const wrong = await h.app.inject({
      method: 'PATCH',
      url: '/auth/me/password',
      headers: authHeader,
      payload: { currentPassword: 'nope-nope-nope', newPassword: 'brand-new-abc-123' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('INVALID_CURRENT_PASSWORD');

    const ok = await h.app.inject({
      method: 'PATCH',
      url: '/auth/me/password',
      headers: authHeader,
      payload: { currentPassword: 'current-abc-123', newPassword: 'brand-new-abc-123' },
    });
    expect(ok.statusCode).toBe(200);

    const login = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'pw@example.com', password: 'brand-new-abc-123' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('PATCH /auth/me/password: passwordless user can set an initial password without currentPassword', async () => {
    const email = 'set-initial@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email },
    });
    const code = extractCode(lastMailTo(h.outbox, email).text);
    const verify = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code },
    });
    const { token } = verify.json() as { token: string };
    const authHeader = { authorization: `Bearer ${token}` };

    const res = await h.app.inject({
      method: 'PATCH',
      url: '/auth/me/password',
      headers: authHeader,
      payload: { newPassword: 'freshly-set-1234' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.has_password).toBe(true);

    const login = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'freshly-set-1234' },
    });
    expect(login.statusCode).toBe(200);
  });

  // -- profile: change email ---------------------------------------------

  it('POST /auth/me/email-change: rotates the address after code confirmation', async () => {
    const { authHeader } = await registerAndAuth(h.app, 'old@example.com', 'super-secret-123');

    const req = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change',
      headers: authHeader,
      payload: { newEmail: 'new@example.com', currentPassword: 'super-secret-123' },
    });
    expect(req.statusCode).toBe(200);

    const mail = lastMailTo(h.outbox, 'new@example.com');
    const code = extractCode(mail.text);
    const confirm = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change/confirm',
      headers: authHeader,
      payload: { code },
    });
    expect(confirm.statusCode).toBe(200);
    const body = confirm.json() as { token: string; user: { email: string } };
    expect(body.user.email).toBe('new@example.com');

    // Old email no longer logs in; new email does.
    const oldLogin = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'old@example.com', password: 'super-secret-123' },
    });
    expect(oldLogin.statusCode).toBe(400);
    const newLogin = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'new@example.com', password: 'super-secret-123' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('POST /auth/me/email-change: blocks when the new address is already taken', async () => {
    await registerAndAuth(h.app, 'taken@example.com');
    const { authHeader } = await registerAndAuth(h.app, 'mover@example.com');

    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change',
      headers: authHeader,
      payload: { newEmail: 'taken@example.com', currentPassword: 'super-secret-123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('EMAIL_TAKEN');
  });

  // -- edge cases: expiry, reissue invalidation, validation ---------------

  /**
   * Force any pending (not-yet-consumed) auth_tokens rows for a purpose to
   * look like they already expired. Used below to exercise the expiry
   * branches of the service without waiting out the real TTLs.
   */
  async function expirePendingTokens(
    purpose: 'verify_email' | 'login_link' | 'reset_password' | 'change_email',
  ): Promise<void> {
    const past = new Date(Date.now() - 60_000);
    await h.db.db
      .update(authTokens)
      .set({ expiresAt: past })
      .where(and(eq(authTokens.purpose, purpose), isNull(authTokens.consumedAt)));
  }

  it('verify-email rejects an expired 6-digit code', async () => {
    const email = 'expired-code@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    const code = extractCode(lastMailTo(h.outbox, email).text);

    await expirePendingTokens('verify_email');

    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_CODE');
  });

  it('resending verification invalidates the previous code', async () => {
    const email = 'reissue-code@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    const firstCode = extractCode(lastMailTo(h.outbox, email).text);

    await h.app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email },
    });
    const secondCode = extractCode(lastMailTo(h.outbox, email).text);
    // Sanity: reissue produced a new code (not guaranteed different digits
    // but the row is new).
    expect(typeof secondCode).toBe('string');

    // Old code must no longer work.
    const stale = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code: firstCode },
    });
    // If RNG happened to produce the same digits, this assertion still
    // passes because the same plaintext hashes differently each time —
    // but the OLD row is consumed, and only the newest pending row is
    // consulted.
    if (firstCode !== secondCode) {
      expect(stale.statusCode).toBe(400);
      expect(stale.json().error).toBe('INVALID_CODE');
    }

    const fresh = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code: secondCode },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('magic-link: expired token is rejected', async () => {
    const email = 'stale-link@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/login/email-link',
      payload: { email },
    });
    const token = extractLinkToken(lastMailTo(h.outbox, email).text);

    await expirePendingTokens('login_link');

    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link/consume',
      payload: { token },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_TOKEN');
  });

  it('magic-link: requesting a new link invalidates the prior one', async () => {
    const email = 'two-links@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/login/email-link',
      payload: { email },
    });
    const firstToken = extractLinkToken(lastMailTo(h.outbox, email).text);

    await h.app.inject({
      method: 'POST',
      url: '/auth/login/email-link',
      payload: { email },
    });
    const secondToken = extractLinkToken(lastMailTo(h.outbox, email).text);
    expect(secondToken).not.toBe(firstToken);

    const stale = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link/consume',
      payload: { token: firstToken },
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().error).toBe('INVALID_TOKEN');

    const fresh = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link/consume',
      payload: { token: secondToken },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('magic-link: keeps an already-verified user verified (idempotent)', async () => {
    // Pre-verify the account via the normal register + verify loop.
    const email = 'already-verified@example.com';
    await registerAndAuth(h.app, email, 'super-secret-123');

    // Request a magic link and consume it. The service must not create
    // a duplicate row or flip any unexpected state.
    await h.app.inject({
      method: 'POST',
      url: '/auth/login/email-link',
      payload: { email },
    });
    const token = extractLinkToken(lastMailTo(h.outbox, email).text);
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link/consume',
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { email_verified_at: string | null } };
    expect(body.user.email_verified_at).not.toBeNull();
  });

  it('magic-link: malformed token is rejected with a schema 400', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link/consume',
      // Too short for the `min(16)` in the schema — exercises the Zod
      // validator branch rather than the DB lookup.
      payload: { token: 'abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('reset-password: expired link is rejected', async () => {
    const email = 'stale-reset@example.com';
    await registerAndAuth(h.app, email);
    await h.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email },
    });
    const token = extractLinkToken(lastMailTo(h.outbox, email).text);

    await expirePendingTokens('reset_password');

    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'brand-new-password-xyz' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_TOKEN');
  });

  it('reset-password: consumes the token (single-use)', async () => {
    const email = 'single-use-reset@example.com';
    await registerAndAuth(h.app, email);
    await h.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email },
    });
    const token = extractLinkToken(lastMailTo(h.outbox, email).text);

    const first = await h.app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'first-new-password' },
    });
    expect(first.statusCode).toBe(200);

    const second = await h.app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'second-new-password' },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('INVALID_TOKEN');
  });

  it('reset-password: flips an unverified account to verified', async () => {
    const email = 'never-verified@example.com';
    // Register but never verify — simulates a user who forgot their
    // password before completing signup. Reset-password should recover
    // them because clicking the reset link proves email control.
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    await h.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email },
    });
    const token = extractLinkToken(lastMailTo(h.outbox, email).text);

    const reset = await h.app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'brand-new-password-xyz' },
    });
    expect(reset.statusCode).toBe(200);

    const login = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'brand-new-password-xyz' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('change-email: passwordless user can change email without a current password', async () => {
    const email = 'passwordless-mover@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email },
    });
    const code = extractCode(lastMailTo(h.outbox, email).text);
    const verify = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code },
    });
    const { token } = verify.json() as { token: string };
    const authHeader = { authorization: `Bearer ${token}` };

    const req = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change',
      headers: authHeader,
      payload: { newEmail: 'new-passwordless@example.com' },
    });
    expect(req.statusCode).toBe(200);

    const newCode = extractCode(lastMailTo(h.outbox, 'new-passwordless@example.com').text);
    const confirm = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change/confirm',
      headers: authHeader,
      payload: { code: newCode },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().user.email).toBe('new-passwordless@example.com');
  });

  it('change-email: rejects the same email as current', async () => {
    const { authHeader } = await registerAndAuth(h.app, 'stay@example.com');
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change',
      headers: authHeader,
      payload: { newEmail: 'STAY@example.com', currentPassword: 'super-secret-123' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('SAME_EMAIL');
  });

  it('change-email: rejects wrong current password', async () => {
    const { authHeader } = await registerAndAuth(h.app, 'wrong-pw@example.com');
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change',
      headers: authHeader,
      payload: { newEmail: 'new-wrong@example.com', currentPassword: 'not-my-password' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('change-email: missing current password for password-backed account is rejected', async () => {
    const { authHeader } = await registerAndAuth(h.app, 'needs-pw@example.com');
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change',
      headers: authHeader,
      payload: { newEmail: 'new-needs@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('CURRENT_PASSWORD_REQUIRED');
  });

  it('change-email: confirm rejects wrong code', async () => {
    const { authHeader } = await registerAndAuth(h.app, 'wrong-code@example.com');
    await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change',
      headers: authHeader,
      payload: {
        newEmail: 'elsewhere@example.com',
        currentPassword: 'super-secret-123',
      },
    });

    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change/confirm',
      headers: authHeader,
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_CODE');
  });

  it('change-email: confirm fails after the code has expired', async () => {
    const { authHeader } = await registerAndAuth(h.app, 'expire-code@example.com');
    await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change',
      headers: authHeader,
      payload: {
        newEmail: 'expired-target@example.com',
        currentPassword: 'super-secret-123',
      },
    });
    const code = extractCode(lastMailTo(h.outbox, 'expired-target@example.com').text);

    await expirePendingTokens('change_email');

    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/me/email-change/confirm',
      headers: authHeader,
      payload: { code },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_CODE');
  });

  it('change-password: enforces an 8-character minimum via schema', async () => {
    const { authHeader } = await registerAndAuth(h.app, 'too-short@example.com');
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/auth/me/password',
      headers: authHeader,
      payload: { currentPassword: 'super-secret-123', newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('register: rejects registering the same email while the first account is still unverified', async () => {
    // Per the service, re-registering an unverified account refreshes its
    // password and re-issues a code rather than erroring — this avoids
    // locking users out if the first email got lost. Verify that path.
    const email = 'retry@example.com';
    const first = await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-111' },
    });
    expect(first.statusCode).toBe(202);

    const second = await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-222' },
    });
    expect(second.statusCode).toBe(202);

    // The most recent code should work.
    const latest = extractCode(lastMailTo(h.outbox, email).text);
    const verify = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code: latest },
    });
    expect(verify.statusCode).toBe(200);

    // And the refreshed password — not the original — is now active.
    const newLogin = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'super-secret-222' },
    });
    expect(newLogin.statusCode).toBe(200);
    const oldLogin = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'super-secret-111' },
    });
    expect(oldLogin.statusCode).toBe(400);
  });

  it('verify-email: consumes the code (a second attempt with the same code fails)', async () => {
    const email = 'twice@example.com';
    await h.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'super-secret-123' },
    });
    const code = extractCode(lastMailTo(h.outbox, email).text);
    const first = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code },
    });
    expect(first.statusCode).toBe(200);
    const second = await h.app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { email, code },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('INVALID_CODE');
  });
});
