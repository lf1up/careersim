import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/config/env.js';

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/careersim',
  AGENT_API_URL: 'http://localhost:8001',
  JWT_SECRET: 'test-secret-test-secret-test-secret',
  ALTCHA_HMAC_KEY: 'test-altcha-hmac-key-test-altcha-hmac-key',
};

describe('loadEnv', () => {
  it('allows local sender domains when SMTP is disabled', () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      MAIL_FROM: 'careersim.local <no-reply@careersim.local>',
    });

    expect(env.MAIL_FROM).toBe('careersim.local <no-reply@careersim.local>');
  });

  it('rejects local sender domains when production SMTP is enabled', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.resend.com',
        MAIL_FROM: 'careersim.local <no-reply@careersim.local>',
      }),
    ).toThrow(/MAIL_FROM must use a verified sender domain/);
  });

  it('allows verified sender domains when production SMTP is enabled', () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.resend.com',
      MAIL_FROM: 'careersim.local <no-reply@careersim.local>',
    });

    expect(env.MAIL_FROM).toBe('careersim.local <no-reply@careersim.local>');
  });
});
