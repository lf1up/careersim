import { contactClientHeaders } from './contact-client';
import { clientIp } from './contact-rate-limit';

/** Keep CAPTCHA consumption in the API's shared, atomic replay registry. */
export async function captchaRequest(path: string, request: Request, payload?: string): Promise<Response> {
  const base = (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/v1').replace(/\/+$/, '');
  const secret = process.env.ALTCHA_HMAC_KEY?.trim();
  if (!secret) return Response.json({ error: 'Verification service unavailable.' }, { status: 503 });
  try {
    return await fetch(`${base}/auth/challenge${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...contactClientHeaders(clientIp(request), secret) },
      ...(payload === undefined ? {} : { body: JSON.stringify({ altcha: payload }) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
  } catch {
    return Response.json({ error: 'Verification service unavailable.' }, { status: 503 });
  }
}
