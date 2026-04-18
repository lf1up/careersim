import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';

export interface JwtPayload {
  sub: string;
  email: string;
}

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
  await app.register(fastifyJwt, {
    secret: opts.secret,
    sign: { expiresIn: opts.expiresIn },
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
