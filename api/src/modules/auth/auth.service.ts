import argon2 from 'argon2';
import { eq } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client.js';
import { users, type UserRow } from '../../db/schema.js';
import { conflict } from '../../plugins/errors.js';

export interface AuthService {
  register(email: string, password: string): Promise<UserRow>;
  verifyCredentials(email: string, password: string): Promise<UserRow | null>;
  findById(id: string): Promise<UserRow | null>;
}

export function createAuthService(db: AppDatabase): AuthService {
  return {
    async register(email, password) {
      const normalized = email.trim().toLowerCase();
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1);
      if (existing.length > 0) {
        throw conflict('Email already registered', 'EMAIL_TAKEN');
      }
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const [row] = await db
        .insert(users)
        .values({ email: normalized, passwordHash })
        .returning();
      if (!row) throw new Error('Failed to create user');
      return row;
    },

    async verifyCredentials(email, password) {
      const normalized = email.trim().toLowerCase();
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1);
      if (!row) return null;
      const ok = await argon2.verify(row.passwordHash, password);
      return ok ? row : null;
    },

    async findById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    },
  };
}
