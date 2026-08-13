import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';

export interface JwtPayload {
  sub: string;
  email: string;
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
  opts: { secret: string; expiresIn: string },
): Promise<void> {
  // @fastify/cookie must precede @fastify/jwt so request.cookies is
  // populated before jwtVerify looks for the session-cookie fallback.
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: opts.secret,
    sign: { expiresIn: opts.expiresIn },
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });

  app.decorate('authenticate', async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing token' });
    }
  });
}
