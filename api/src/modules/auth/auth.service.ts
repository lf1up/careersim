import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client.js';
import {
  authTokens,
  users,
  type AuthTokenPurpose,
  type AuthTokenRow,
  type UserRow,
} from '../../db/schema.js';
import { badRequest, conflict, forbidden } from '../../plugins/errors.js';

// -- Public types -------------------------------------------------------

export interface UserDto {
  id: string;
  email: string;
  email_verified_at: string | null;
  has_password: boolean;
  created_at: string;
}

export interface IssuedCode {
  user: UserRow;
  code: string;
  purpose: 'verify_email' | 'change_email';
  newEmail?: string;
}

export interface IssuedLink {
  user: UserRow;
  token: string;
  purpose: 'login_link' | 'reset_password';
}

export interface AuthService {
  toDto(user: UserRow): UserDto;

  // Registration / verification
  startRegistration(email: string, password?: string): Promise<IssuedCode>;
  resendVerification(email: string): Promise<IssuedCode | null>;
  verifyEmail(email: string, code: string): Promise<UserRow>;

  // Password login
  verifyCredentials(email: string, password: string): Promise<UserRow>;

  // Magic link (passwordless login)
  startEmailLinkLogin(email: string): Promise<IssuedLink | null>;
  consumeMagicLink(token: string): Promise<UserRow>;

  // Forgot / reset password
  startPasswordReset(email: string): Promise<IssuedLink | null>;
  resetPassword(token: string, newPassword: string): Promise<UserRow>;

  // Profile
  findById(id: string): Promise<UserRow | null>;
  changePassword(
    userId: string,
    newPassword: string,
    currentPassword?: string,
  ): Promise<UserRow>;
  startEmailChange(
    userId: string,
    newEmail: string,
    currentPassword?: string,
  ): Promise<IssuedCode>;
  confirmEmailChange(userId: string, code: string): Promise<UserRow>;
}

// -- Helpers ------------------------------------------------------------

const CODE_TTL_MINUTES = 10;
const LOGIN_LINK_TTL_MINUTES = 60;
const RESET_LINK_TTL_MINUTES = 30;

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function generateOpaqueToken(): string {
  // 32 random bytes → 64 hex chars. Used as URL `?token=`.
  return randomBytes(32).toString('hex');
}

function generateSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function hashCode(code: string): Promise<string> {
  return argon2.hash(code, { type: argon2.argon2id });
}

async function verifyHashedCode(storedHash: string, code: string): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, code);
  } catch {
    return false;
  }
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function toDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    email_verified_at: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    has_password: Boolean(user.passwordHash),
    created_at: user.createdAt.toISOString(),
  };
}

// -- Implementation -----------------------------------------------------

export function createAuthService(db: AppDatabase): AuthService {
  // --- users -----------------------------------------------------------
  async function findByEmail(email: string): Promise<UserRow | null> {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, normaliseEmail(email)))
      .limit(1);
    return row ?? null;
  }

  async function findById(id: string): Promise<UserRow | null> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

  // --- auth_tokens -----------------------------------------------------
  async function invalidatePendingTokens(
    userId: string,
    purpose: AuthTokenPurpose,
  ): Promise<void> {
    const now = new Date();
    await db
      .update(authTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.consumedAt),
        ),
      );
  }

  /** Issue a 6-digit code and persist its argon2 hash. */
  async function issueCode(
    userId: string,
    purpose: 'verify_email' | 'change_email',
    newEmail?: string,
  ): Promise<string> {
    await invalidatePendingTokens(userId, purpose);
    const code = generateSixDigitCode();
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
    await db.insert(authTokens).values({
      userId,
      purpose,
      codeHash,
      newEmail: newEmail ?? null,
      expiresAt,
    });
    return code;
  }

  /** Issue a long opaque URL token and store its sha256 hash. */
  async function issueLink(
    userId: string,
    purpose: 'login_link' | 'reset_password',
    ttlMinutes: number,
  ): Promise<string> {
    await invalidatePendingTokens(userId, purpose);
    const token = generateOpaqueToken();
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await db.insert(authTokens).values({
      userId,
      purpose,
      tokenHash,
      expiresAt,
    });
    return token;
  }

  /** Find a pending (not-consumed, not-expired) code token for a user. */
  async function findPendingCodeToken(
    userId: string,
    purpose: 'verify_email' | 'change_email',
  ): Promise<AuthTokenRow | null> {
    const rows = await db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.consumedAt),
        ),
      );
    // There may be multiple for legacy reasons; pick the newest unexpired.
    const now = Date.now();
    const candidates = rows
      .filter((r) => r.expiresAt.getTime() > now && r.codeHash)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return candidates[0] ?? null;
  }

  /** Find a pending link token by the raw URL token (caller provides it). */
  async function findPendingLinkToken(
    purpose: 'login_link' | 'reset_password',
    rawToken: string,
  ): Promise<AuthTokenRow | null> {
    const tokenHash = sha256Hex(rawToken);
    const [row] = await db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.purpose, purpose),
          eq(authTokens.tokenHash, tokenHash),
          isNull(authTokens.consumedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    // tokenHash is the primary lookup, but also constant-time compare the
    // stored hash against what we computed.
    if (!row.tokenHash || !constantTimeEqualHex(row.tokenHash, tokenHash)) return null;
    return row;
  }

  async function consumeToken(id: string): Promise<void> {
    await db
      .update(authTokens)
      .set({ consumedAt: new Date() })
      .where(eq(authTokens.id, id));
  }

  async function markEmailVerified(userId: string): Promise<UserRow> {
    const [row] = await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!row) throw new Error('User disappeared during verification');
    return row;
  }

  // --- Public API ------------------------------------------------------

  return {
    toDto,

    async startRegistration(emailInput, password) {
      const email = normaliseEmail(emailInput);
      const existing = await findByEmail(email);

      let user: UserRow;
      if (existing) {
        // If already verified, this must be a duplicate signup — surface a
        // clear 409. If still unverified we let them restart the flow.
        if (existing.emailVerifiedAt) {
          throw conflict('Email already registered', 'EMAIL_TAKEN');
        }

        // Update the password (if supplied) on the still-unverified row.
        const passwordHash = password
          ? await argon2.hash(password, { type: argon2.argon2id })
          : existing.passwordHash;
        const [updated] = await db
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, existing.id))
          .returning();
        user = updated ?? existing;
      } else {
        const passwordHash = password
          ? await argon2.hash(password, { type: argon2.argon2id })
          : null;
        const [row] = await db
          .insert(users)
          .values({ email, passwordHash })
          .returning();
        if (!row) throw new Error('Failed to create user');
        user = row;
      }

      const code = await issueCode(user.id, 'verify_email');
      return { user, code, purpose: 'verify_email' };
    },

    async resendVerification(emailInput) {
      const email = normaliseEmail(emailInput);
      const existing = await findByEmail(email);
      if (!existing || existing.emailVerifiedAt) return null; // no leak
      const code = await issueCode(existing.id, 'verify_email');
      return { user: existing, code, purpose: 'verify_email' };
    },

    async verifyEmail(emailInput, code) {
      const email = normaliseEmail(emailInput);
      const user = await findByEmail(email);
      if (!user) throw badRequest('Invalid or expired code', 'INVALID_CODE');

      const token = await findPendingCodeToken(user.id, 'verify_email');
      if (!token || !token.codeHash) {
        throw badRequest('Invalid or expired code', 'INVALID_CODE');
      }
      const ok = await verifyHashedCode(token.codeHash, code);
      if (!ok) throw badRequest('Invalid or expired code', 'INVALID_CODE');

      await consumeToken(token.id);
      return markEmailVerified(user.id);
    },

    async verifyCredentials(emailInput, password) {
      const email = normaliseEmail(emailInput);
      const user = await findByEmail(email);
      if (!user) throw badRequest('Invalid email or password', 'INVALID_CREDENTIALS');
      if (!user.passwordHash) {
        throw forbidden(
          'This account was created without a password. Use the email sign-in link instead.',
          'PASSWORDLESS_ACCOUNT',
        );
      }
      const ok = await argon2.verify(user.passwordHash, password);
      if (!ok) throw badRequest('Invalid email or password', 'INVALID_CREDENTIALS');
      if (!user.emailVerifiedAt) {
        throw forbidden(
          'Please confirm your email before signing in.',
          'EMAIL_NOT_VERIFIED',
        );
      }
      return user;
    },

    async startEmailLinkLogin(emailInput) {
      const email = normaliseEmail(emailInput);
      let user = await findByEmail(email);
      if (!user) {
        // Create an unverified passwordless stub so the magic link both
        // signs the user in and registers them in one step. This matches
        // common "email-first" UX.
        const [created] = await db
          .insert(users)
          .values({ email, passwordHash: null })
          .returning();
        if (!created) return null;
        user = created;
      }
      const token = await issueLink(user.id, 'login_link', LOGIN_LINK_TTL_MINUTES);
      return { user, token, purpose: 'login_link' };
    },

    async consumeMagicLink(rawToken) {
      const row = await findPendingLinkToken('login_link', rawToken);
      if (!row) throw badRequest('Invalid or expired link', 'INVALID_TOKEN');
      await consumeToken(row.id);
      const user = await findById(row.userId);
      if (!user) throw badRequest('Invalid or expired link', 'INVALID_TOKEN');
      // Clicking the link proves the user controls the address; mark them
      // verified if they weren't already.
      if (!user.emailVerifiedAt) {
        return markEmailVerified(user.id);
      }
      return user;
    },

    async startPasswordReset(emailInput) {
      const email = normaliseEmail(emailInput);
      const user = await findByEmail(email);
      if (!user) return null; // no leak
      const token = await issueLink(user.id, 'reset_password', RESET_LINK_TTL_MINUTES);
      return { user, token, purpose: 'reset_password' };
    },

    async resetPassword(rawToken, newPassword) {
      const row = await findPendingLinkToken('reset_password', rawToken);
      if (!row) throw badRequest('Invalid or expired link', 'INVALID_TOKEN');
      await consumeToken(row.id);

      const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
      const [updated] = await db
        .update(users)
        .set({
          passwordHash,
          // Password reset also proves control of the email: verify it.
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.userId))
        .returning();
      if (!updated) throw badRequest('Invalid or expired link', 'INVALID_TOKEN');
      return updated;
    },

    findById,

    async changePassword(userId, newPassword, currentPassword) {
      const user = await findById(userId);
      if (!user) throw badRequest('User not found', 'USER_NOT_FOUND');
      if (user.passwordHash) {
        if (!currentPassword) {
          throw badRequest('Current password is required', 'CURRENT_PASSWORD_REQUIRED');
        }
        const ok = await argon2.verify(user.passwordHash, currentPassword);
        if (!ok) {
          throw badRequest('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
        }
      }
      const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
      const [updated] = await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) throw badRequest('User not found', 'USER_NOT_FOUND');
      return updated;
    },

    async startEmailChange(userId, newEmailInput, currentPassword) {
      const newEmail = normaliseEmail(newEmailInput);
      const user = await findById(userId);
      if (!user) throw badRequest('User not found', 'USER_NOT_FOUND');

      if (newEmail === user.email) {
        throw badRequest('New email matches current email', 'SAME_EMAIL');
      }

      // If the account has a password, require it to avoid session-hijack
      // trivially taking over the email. Passwordless accounts skip this.
      if (user.passwordHash) {
        if (!currentPassword) {
          throw badRequest('Current password is required', 'CURRENT_PASSWORD_REQUIRED');
        }
        const ok = await argon2.verify(user.passwordHash, currentPassword);
        if (!ok) {
          throw badRequest('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
        }
      }

      const clash = await findByEmail(newEmail);
      if (clash) throw conflict('Email already in use', 'EMAIL_TAKEN');

      const code = await issueCode(user.id, 'change_email', newEmail);
      return { user, code, purpose: 'change_email', newEmail };
    },

    async confirmEmailChange(userId, code) {
      const token = await findPendingCodeToken(userId, 'change_email');
      if (!token || !token.codeHash || !token.newEmail) {
        throw badRequest('Invalid or expired code', 'INVALID_CODE');
      }
      const ok = await verifyHashedCode(token.codeHash, code);
      if (!ok) throw badRequest('Invalid or expired code', 'INVALID_CODE');

      // Re-check the target address isn't taken right before the swap.
      const clash = await findByEmail(token.newEmail);
      if (clash && clash.id !== userId) {
        throw conflict('Email already in use', 'EMAIL_TAKEN');
      }

      await consumeToken(token.id);
      const [updated] = await db
        .update(users)
        .set({
          email: token.newEmail,
          // New address is proven by the code; keep verified state.
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) throw badRequest('User not found', 'USER_NOT_FOUND');
      return updated;
    },
  };
}

