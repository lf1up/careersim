import { createChallenge } from 'altcha-lib/v1';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPIRES_IN_MS = 10 * 60 * 1000;

/**
 * ALTCHA challenge issuer for the /business contact form.
 *
 * Served from the apex `web` project (not rewritten to LANDING_ORIGIN) so
 * browser subrequests share the same Vercel challenge session as the page.
 */
export async function GET(): Promise<NextResponse> {
  const hmacKey = process.env.ALTCHA_HMAC_KEY?.trim();
  if (!hmacKey) {
    return NextResponse.json(
      { error: 'Challenge service unavailable.' },
      { status: 503 },
    );
  }

  const maxNumber = Number(process.env.ALTCHA_MAX_NUMBER?.trim()) || 50_000;

  const challenge = await createChallenge({
    hmacKey,
    maxNumber,
    expires: new Date(Date.now() + EXPIRES_IN_MS),
  });

  return NextResponse.json(challenge, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}
