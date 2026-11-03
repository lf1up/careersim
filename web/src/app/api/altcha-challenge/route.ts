import { NextResponse } from 'next/server';
import { captchaRequest } from '@/lib/captcha';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ALTCHA challenge issuer for the /business contact form.
 *
 * Served from the apex `web` project (not rewritten to LANDING_ORIGIN) so
 * browser subrequests share the same Vercel challenge session as the page.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const response = await captchaRequest('', request);
  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
