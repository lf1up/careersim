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
      MAIL_FROM: 'CareerSIM <no-reply@careersim.com>',
    });

    expect(env.MAIL_FROM).toBe('CareerSIM <no-reply@careersim.com>');
  });

  describe('API_VERSION_PREFIX', () => {
    it('means "no prefix" when unset or empty (bare-container / cloud default)', () => {
      expect(loadEnv(baseEnv).API_VERSION_PREFIX).toBe('');
      expect(loadEnv({ ...baseEnv, API_VERSION_PREFIX: '' }).API_VERSION_PREFIX).toBe('');
      expect(loadEnv({ ...baseEnv, API_VERSION_PREFIX: '  ' }).API_VERSION_PREFIX).toBe('');
    });

    it('accepts bare numbers, v-prefixed values, and stray slashes equivalently', () => {
      expect(loadEnv({ ...baseEnv, API_VERSION_PREFIX: '1' }).API_VERSION_PREFIX).toBe('v1');
      expect(loadEnv({ ...baseEnv, API_VERSION_PREFIX: 'v1' }).API_VERSION_PREFIX).toBe('v1');
      expect(loadEnv({ ...baseEnv, API_VERSION_PREFIX: '2' }).API_VERSION_PREFIX).toBe('v2');
      expect(loadEnv({ ...baseEnv, API_VERSION_PREFIX: '/V3/' }).API_VERSION_PREFIX).toBe('v3');
    });

    it('rejects values that are not a single path segment', () => {
      expect(() => loadEnv({ ...baseEnv, API_VERSION_PREFIX: 'v1/extra' })).toThrow(
        /API_VERSION_PREFIX/,
      );
    });
  });
});
