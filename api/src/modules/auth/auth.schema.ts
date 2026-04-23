import { z } from 'zod';

// -- Primitives ---------------------------------------------------------

const emailField = z.email().max(320);
const passwordField = z.string().min(8).max(200);
const codeField = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');
// Opaque URL token we emit for magic-link / reset-password flows. 32 bytes
// hex-encoded => 64 chars; be permissive about length for forward-compat.
const opaqueTokenField = z.string().min(16).max(256);
// Base64-encoded JSON blob produced by the altcha-widget (v1 payload).
// Optional at the schema layer: `app.altcha.verify()` enforces presence
// at runtime so the test harness can run with `bypass: true` without
// every request including a real payload.
const altchaField = z.string().min(8).max(4096).optional();

// -- Requests -----------------------------------------------------------

export const registerRequestSchema = z.object({
  email: emailField,
  password: passwordField.optional(),
  altcha: altchaField,
});

export const credentialsSchema = z.object({
  email: emailField,
  password: passwordField,
  altcha: altchaField,
});

export const verifyEmailRequestSchema = z.object({
  email: emailField,
  code: codeField,
});

// Note: this endpoint is intentionally *not* gated by ALTCHA. The
// pending-registration record that makes a resend meaningful can only be
// created by `/auth/register`, which *is* captcha-gated, so an attacker
// cannot cheaply manufacture targets to resend against. The per-mailbox
// rate limit (`emailSendByMailbox: 3/hour`) is the abuse cap here.
export const resendVerificationRequestSchema = z.object({
  email: emailField,
});

export const emailOnlyRequestSchema = z.object({
  email: emailField,
  altcha: altchaField,
});

export const consumeMagicLinkRequestSchema = z.object({
  token: opaqueTokenField,
});

export const resetPasswordRequestSchema = z.object({
  token: opaqueTokenField,
  password: passwordField,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: passwordField.optional(),
  newPassword: passwordField,
});

export const changeEmailRequestSchema = z.object({
  newEmail: emailField,
  currentPassword: passwordField.optional(),
});

export const changeEmailConfirmRequestSchema = z.object({
  code: codeField,
});

// -- Responses ----------------------------------------------------------

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  email_verified_at: z.iso.datetime().nullable(),
  has_password: z.boolean(),
  created_at: z.iso.datetime(),
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: userSchema,
});

export const meResponseSchema = userSchema;

export const pendingRegistrationResponseSchema = z.object({
  pending: z.literal(true),
  email: z.email(),
});

export const noContentResponseSchema = z.object({
  ok: z.literal(true),
});

export const changePasswordResponseSchema = z.object({
  ok: z.literal(true),
  user: userSchema,
});

// -- Inferred types -----------------------------------------------------

export type Credentials = z.infer<typeof credentialsSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type UserDto = z.infer<typeof userSchema>;
