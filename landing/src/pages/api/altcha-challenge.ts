import type { APIRoute } from 'astro';
import { createChallenge } from 'altcha-lib/v1';

export const prerender = false;

const expiresInMs = 10 * 60 * 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const GET: APIRoute = async () => {
  const hmacKey = import.meta.env.ALTCHA_HMAC_KEY?.trim();
  if (!hmacKey) {
    return json({ error: 'Challenge service unavailable.' }, 503);
  }

  const maxNumber = Number(import.meta.env.ALTCHA_MAX_NUMBER?.trim()) || 50_000;

  const challenge = await createChallenge({
    hmacKey,
    maxNumber,
    expires: new Date(Date.now() + expiresInMs),
  });

  return json(challenge);
};
