import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChallenge, solveChallenge } from 'altcha-lib/v1';

import { buildTestApp, TEST_ALTCHA, type TestHarness } from './helpers/build-test-app.js';

/**
 * Shape of the v1 challenge JSON returned by GET /auth/challenge. Mirrors
 * the runtime shape from altcha-lib so the test can feed it back into
 * `solveChallenge`.
 */
interface V1Challenge {
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  maxnumber?: number;
}

describe('altcha CAPTCHA', () => {
  // -- bypass mode: default harness ---------------------------------------

  describe('with bypass enabled (default test harness)', () => {
    let h: TestHarness;
    beforeEach(async () => {
      h = await buildTestApp();
    });
    afterEach(async () => {
      await h.close();
    });

    it('GET /auth/challenge issues a fresh signed challenge', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/auth/challenge' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as V1Challenge;
      expect(body.algorithm).toBeTruthy();
      expect(body.challenge).toBeTruthy();
      expect(body.salt).toBeTruthy();
      expect(body.signature).toBeTruthy();
      expect(typeof body.maxnumber).toBe('number');
    });

    it('the bypass token is accepted by /auth/register', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'bypass@example.com',
          password: 'super-secret-123',
          altcha: TEST_ALTCHA,
        },
      });
      expect(res.statusCode).toBe(202);
    });

    it('a garbage altcha payload is still rejected even in bypass mode', async () => {
      // Bypass accepts ONLY the fixed token / missing payload; anything
      // else is routed through the real verifier and must fail.
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'garbage@example.com',
          password: 'super-secret-123',
          altcha: 'this-is-not-a-valid-solution',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CAPTCHA_INVALID');
    });
  });

  // -- bypass disabled: exercise real PoW path ----------------------------

  describe('with bypass disabled (production-style)', () => {
    let h: TestHarness;
    beforeEach(async () => {
      h = await buildTestApp({ altchaBypass: false });
    });
    afterEach(async () => {
      await h.close();
    });

    it('/auth/register rejects requests without an altcha payload', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'no-captcha@example.com',
          password: 'super-secret-123',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CAPTCHA_REQUIRED');
    });

    it('/auth/login rejects requests with a bogus altcha payload', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'irrelevant@example.com',
          password: 'super-secret-123',
          altcha: 'not-even-base64',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CAPTCHA_INVALID');
    });

    it('/auth/forgot-password rejects the bypass token when bypass is off', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'who@example.com', altcha: TEST_ALTCHA },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CAPTCHA_INVALID');
    });

    it('solves a real challenge end-to-end and completes /auth/register', async () => {
      // 1. Fetch a challenge from the API — same path the altcha-widget
      //    takes in the browser.
      const challengeRes = await h.app.inject({ method: 'GET', url: '/auth/challenge' });
      expect(challengeRes.statusCode).toBe(200);
      const challenge = challengeRes.json() as V1Challenge;

      // 2. Solve the proof-of-work in-process. The harness configures a
      //    low `maxNumber` so this resolves in milliseconds.
      const { promise } = solveChallenge(
        challenge.challenge,
        challenge.salt,
        challenge.algorithm,
        challenge.maxnumber,
      );
      const solution = await promise;
      if (!solution) throw new Error('failed to solve PoW challenge');

      // 3. Pack the solution into the payload the widget would submit.
      //    altcha-lib accepts both a Payload object and a base64 JSON
      //    string; we use the base64 form to match widget output.
      const payload = Buffer.from(
        JSON.stringify({
          algorithm: challenge.algorithm,
          challenge: challenge.challenge,
          number: solution.number,
          salt: challenge.salt,
          signature: challenge.signature,
          took: solution.took ?? 0,
        }),
        'utf8',
      ).toString('base64');

      // 4. Happy path: the API accepts it and returns 202 pending.
      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'real-captcha@example.com',
          password: 'super-secret-123',
          altcha: payload,
        },
      });
      expect(res.statusCode).toBe(202);
    });

    it('uses a signature tied to the configured HMAC key (tampering rejected)', async () => {
      // Use the same lib directly but with a DIFFERENT HMAC key. The
      // resulting challenge's signature won't match the server's secret,
      // so verifySolution rejects it even with a valid PoW solution.
      const rogueChallenge = await createChallenge({
        hmacKey: 'some-other-totally-different-key',
        maxNumber: 500,
      });
      const { promise } = solveChallenge(
        rogueChallenge.challenge,
        rogueChallenge.salt,
        rogueChallenge.algorithm,
        rogueChallenge.maxnumber,
      );
      const solution = await promise;
      if (!solution) throw new Error('failed to solve rogue PoW challenge');

      const payload = Buffer.from(
        JSON.stringify({
          algorithm: rogueChallenge.algorithm,
          challenge: rogueChallenge.challenge,
          number: solution.number,
          salt: rogueChallenge.salt,
          signature: rogueChallenge.signature,
          took: solution.took ?? 0,
        }),
        'utf8',
      ).toString('base64');

      const res = await h.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'rogue@example.com',
          password: 'super-secret-123',
          altcha: payload,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CAPTCHA_INVALID');
    });
  });
});
