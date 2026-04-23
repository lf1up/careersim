import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

import { AgentRequestError } from '../agent/client.js';

export class HttpError extends Error {
  /**
   * Optional payload merged into the JSON response body alongside the
   * standard `{ error, message }` envelope. Used (e.g.) by the rate
   * limiter to surface `retryAfter` without needing a second branch
   * in `registerErrorHandler`.
   */
  public readonly extra?: Record<string, unknown>;

  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
    this.extra = extra;
  }
}

export function notFound(message = 'Not found'): HttpError {
  return new HttpError(404, message, 'NOT_FOUND');
}

export function forbidden(message = 'Forbidden', code = 'FORBIDDEN'): HttpError {
  return new HttpError(403, message, code);
}

export function badRequest(message: string, code = 'BAD_REQUEST'): HttpError {
  return new HttpError(400, message, code);
}

export function conflict(message: string, code = 'CONFLICT'): HttpError {
  return new HttpError(409, message, code);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      reply.status(400).send({
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation,
      });
      return;
    }

    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({
        error: error.code ?? 'Error',
        message: error.message,
        ...(error.extra ?? {}),
      });
      return;
    }

    if (error instanceof AgentRequestError) {
      request.log.error(
        { status: error.status, body: error.body.slice(0, 500) },
        'agent request failed',
      );
      reply.status(502).send({
        error: 'BAD_GATEWAY',
        message: 'Upstream agent service error',
      });
      return;
    }

    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        error: error.code ?? 'Error',
        message: error.message,
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled error');
    reply.status(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
  });
}
