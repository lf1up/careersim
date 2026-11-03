import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, lte } from 'drizzle-orm';

import type { AppDatabase } from '../db/client.js';
import { authSessions, users, type UserRow } from '../db/schema.js';

export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
  authVersion: number;
}

/**
 * Name of the httpOnly session cookie the API sets at login/verify time.
 * Browser clients authenticate via this cookie (immune to XSS token
 * theft, unlike localStorage); non-browser clients keep using the
 * `Authorization: Bearer` header — `jwtVerify` checks the header first,
 * then falls back to this cookie.
 */
export const SESSION_COOKIE = 'careersim_auth';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    issueSessionToken: (user: Pick<UserRow, 'id' | 'email' | 'authVersion'>) => Promise<string>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export async function registerAuth(
  app: FastifyInstance,
  opts: { secret: string; expiresIn: string; db: AppDatabase },
): Promise<void> {
  // @fastify/cookie must precede @fastify/jwt so request.cookies is
  // populated before jwtVerify looks for the session-cookie fallback.
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: opts.secret,
    sign: { expiresIn: opts.expiresIn },
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    trusted: async (_request, token) => {
      if (typeof token.jti !== 'string' || typeof token.authVersion !== 'number') return false;
      const [session] = await opts.db.select({ id: authSessions.id }).from(authSessions)
        .innerJoin(users, and(eq(users.id, authSessions.userId), eq(users.authVersion, authSessions.authVersion)))
        .where(and(eq(authSessions.id, token.jti), eq(authSessions.userId, token.sub), eq(authSessions.authVersion, token.authVersion), gt(authSessions.expiresAt, new Date()))).limit(1);
      return Boolean(session);
    },
  });

  app.decorate('issueSessionToken', async (user) => {
    const jti = randomUUID();
    const token = app.jwt.sign({ sub: user.id, email: user.email, jti, authVersion: user.authVersion });
    const { exp } = app.jwt.decode<{ exp: number }>(token)!;
    await opts.db.delete(authSessions).where(lte(authSessions.expiresAt, new Date()));
    // Preserve the version from credential verification: a concurrent reset
    // must also invalidate a login that finishes issuing its token afterward.
    await opts.db.insert(authSessions).values({ id: jti, userId: user.id, authVersion: user.authVersion, expiresAt: new Date(exp * 1000) });
    return token;
  });

  app.decorate('authenticate', async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      await request.jwtVerify();
    } catch {
      return void reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
  });
}
