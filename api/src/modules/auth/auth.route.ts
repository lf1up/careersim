import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AppDatabase } from '../../db/client.js';
import { badRequest } from '../../plugins/errors.js';
import { rateLimitPolicy } from '../../plugins/rate-limit.js';
import { createAuthService, type UserDto } from './auth.service.js';
import {
  authResponseSchema,
  changeEmailConfirmRequestSchema,
  changeEmailRequestSchema,
  changePasswordRequestSchema,
  consumeMagicLinkRequestSchema,
  credentialsSchema,
  emailOnlyRequestSchema,
  meResponseSchema,
  noContentResponseSchema,
  pendingRegistrationResponseSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  userSchema,
  verifyEmailRequestSchema,
} from './auth.schema.js';
import {
  changeEmailMail,
  loginLinkMail,
  resetPasswordMail,
  verifyEmailMail,
} from './auth.templates.js';

interface AuthRouteOptions {
  db: AppDatabase;
  webAppUrl: string;
  mailProductName: string;
}

function buildLinkUrl(webAppUrl: string, path: string, token: string): string {
  const base = webAppUrl.replace(/\/$/, '');
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, opts) => {
  const service = createAuthService(opts.db);

  async function signUser(user: { id: string; email: string }): Promise<string> {
    return app.jwt.sign({ sub: user.id, email: user.email });
  }

  // -- Registration + email verification --------------------------------

  app.post(
    '/auth/register',
    {
      config: { rateLimit: rateLimitPolicy.register() },
      schema: {
        tags: ['auth'],
        summary: 'Begin signup (optionally with a password)',
        description:
          'Creates an unverified account and emails a 6-digit confirmation code. ' +
          'If `password` is omitted the account is created passwordless and the user ' +
          'can either finish sign-in via the code here or request a magic link later.',
        body: registerRequestSchema,
        response: { 202: pendingRegistrationResponseSchema },
      },
    },
    async (request, reply) => {
      const { email, password, altcha } = request.body;
      await app.altcha.verify(altcha);
      const issued = await service.startRegistration(email, password);
      await app.mailer.send(
        verifyEmailMail(issued.user.email, issued.code, opts.mailProductName),
      );
      reply.code(202).send({ pending: true as const, email: issued.user.email });
    },
  );

  app.post(
    '/auth/resend-verification',
    {
      config: { rateLimit: rateLimitPolicy.emailSendByMailbox() },
      schema: {
        tags: ['auth'],
        summary: 'Resend the 6-digit email confirmation code',
        description:
          'Not captcha-gated on purpose: the only way to create a pending-verification ' +
          'record is to hit /auth/register (which is captcha-gated), so an attacker ' +
          "cannot cheaply manufacture targets here. Abuse is capped by the " +
          'per-mailbox rate limit (3/hour).',
        body: resendVerificationRequestSchema,
        response: { 200: noContentResponseSchema },
      },
    },
    async (request) => {
      const issued = await service.resendVerification(request.body.email);
      if (issued) {
        await app.mailer.send(
          verifyEmailMail(issued.user.email, issued.code, opts.mailProductName),
        );
      }
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/verify-email',
    {
      config: { rateLimit: rateLimitPolicy.verifyCode() },
      schema: {
        tags: ['auth'],
        summary: 'Exchange a 6-digit code for a JWT',
        body: verifyEmailRequestSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request) => {
      const { email, code } = request.body;
      const user = await service.verifyEmail(email, code);
      const token = await signUser(user);
      return { token, user: service.toDto(user) };
    },
  );

  // -- Password login --------------------------------------------------

  app.post(
    '/auth/login',
    {
      config: { rateLimit: rateLimitPolicy.login() },
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for a JWT',
        body: credentialsSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request) => {
      const { email, password, altcha } = request.body;
      await app.altcha.verify(altcha);
      const user = await service.verifyCredentials(email, password);
      const token = await signUser(user);
      return { token, user: service.toDto(user) };
    },
  );

  // -- Magic-link login ------------------------------------------------

  app.post(
    '/auth/login/email-link',
    {
      config: { rateLimit: rateLimitPolicy.emailLinkByMailbox() },
      schema: {
        tags: ['auth'],
        summary: 'Email a single-use sign-in link',
        body: emailOnlyRequestSchema,
        response: { 200: noContentResponseSchema },
      },
    },
    async (request) => {
      await app.altcha.verify(request.body.altcha);
      const issued = await service.startEmailLinkLogin(request.body.email);
      if (issued) {
        const url = buildLinkUrl(opts.webAppUrl, '/auth/callback', issued.token);
        await app.mailer.send(
          loginLinkMail(issued.user.email, url, opts.mailProductName),
        );
      }
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/magic-link/consume',
    {
      config: { rateLimit: rateLimitPolicy.consumeToken() },
      schema: {
        tags: ['auth'],
        summary: 'Exchange a magic-link token for a JWT',
        body: consumeMagicLinkRequestSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request) => {
      const user = await service.consumeMagicLink(request.body.token);
      const token = await signUser(user);
      return { token, user: service.toDto(user) };
    },
  );

  // -- Forgot / reset password -----------------------------------------

  app.post(
    '/auth/forgot-password',
    {
      config: { rateLimit: rateLimitPolicy.emailSendByMailbox() },
      schema: {
        tags: ['auth'],
        summary: 'Email a single-use password-reset link',
        body: emailOnlyRequestSchema,
        response: { 200: noContentResponseSchema },
      },
    },
    async (request) => {
      await app.altcha.verify(request.body.altcha);
      const issued = await service.startPasswordReset(request.body.email);
      if (issued) {
        const url = buildLinkUrl(opts.webAppUrl, '/reset-password', issued.token);
        await app.mailer.send(
          resetPasswordMail(issued.user.email, url, opts.mailProductName),
        );
      }
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/reset-password',
    {
      config: { rateLimit: rateLimitPolicy.resetPassword() },
      schema: {
        tags: ['auth'],
        summary: 'Set a new password using a reset-link token',
        body: resetPasswordRequestSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request) => {
      const user = await service.resetPassword(request.body.token, request.body.password);
      const token = await signUser(user);
      return { token, user: service.toDto(user) };
    },
  );

  // -- /auth/me and profile updates ------------------------------------

  app.get(
    '/auth/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Return the current user',
        security: [{ bearerAuth: [] }],
        response: {
          200: meResponseSchema,
          404: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const user = await service.findById(request.user.sub);
      if (!user) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'User not found' };
      }
      return service.toDto(user);
    },
  );

  app.patch(
    '/auth/me/password',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimitPolicy.changePassword() },
      schema: {
        tags: ['auth'],
        summary: 'Set or change your password',
        security: [{ bearerAuth: [] }],
        body: changePasswordRequestSchema,
        response: {
          200: z.object({
            ok: z.literal(true),
            user: userSchema,
          }),
        },
      },
    },
    async (request) => {
      const { currentPassword, newPassword } = request.body;
      const user = await service.changePassword(
        request.user.sub,
        newPassword,
        currentPassword,
      );
      return { ok: true as const, user: service.toDto(user) };
    },
  );

  app.post(
    '/auth/me/email-change',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimitPolicy.requestEmailChange() },
      schema: {
        tags: ['auth'],
        summary: 'Request an email change; sends a code to the new address',
        security: [{ bearerAuth: [] }],
        body: changeEmailRequestSchema,
        response: { 200: noContentResponseSchema },
      },
    },
    async (request) => {
      const { newEmail, currentPassword } = request.body;
      const issued = await service.startEmailChange(
        request.user.sub,
        newEmail,
        currentPassword,
      );
      if (!issued.newEmail) {
        // Defensive: startEmailChange always returns `newEmail`; if not,
        // surface a 500 rather than emailing the wrong address.
        throw badRequest('Internal: missing target email', 'INTERNAL');
      }
      await app.mailer.send(
        changeEmailMail(issued.newEmail, issued.code, opts.mailProductName),
      );
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/me/email-change/confirm',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimitPolicy.confirmEmailChange() },
      schema: {
        tags: ['auth'],
        summary: 'Confirm a pending email change with the 6-digit code',
        security: [{ bearerAuth: [] }],
        body: changeEmailConfirmRequestSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request) => {
      const user = await service.confirmEmailChange(request.user.sub, request.body.code);
      // Re-issue a JWT because the `email` claim changed.
      const token = await signUser(user);
      return { token, user: service.toDto(user) };
    },
  );

  // Return type re-export hint (helps editor pick up UserDto when hovering).
  const _exportTypeHint: UserDto | undefined = undefined;
  void _exportTypeHint;
};
