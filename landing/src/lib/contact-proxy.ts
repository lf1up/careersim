import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/** Standalone landing deployments use the same contact handler as the apex. */
export async function proxyContactRequest(request: Request, path: string): Promise<Response> {
  try {
    const target = new URL(path, (import.meta.env as { LANDING_SITE_URL?: string }).LANDING_SITE_URL);
    if (target.origin === new URL(request.url).origin) throw new Error('Contact proxy loop');
    const secret = (import.meta.env as { ALTCHA_HMAC_KEY?: string }).ALTCHA_HMAC_KEY?.trim();
    if (!secret) throw new Error('Missing contact proxy key');
    // Vercel overwrites X-Forwarded-For. Never forward caller-supplied attestations.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
    const headers = new Headers();
    if (isIP(ip)) {
      const value = `${Math.floor(Date.now() / 1000)}:${ip}`;
      headers.set('x-careersim-client', value);
      headers.set('x-careersim-client-signature', createHmac('sha256', secret).update(`contact-client:${value}`).digest('hex'));
    }
    if (request.method === 'POST') headers.set('content-type', request.headers.get('content-type') || '');
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      ...(request.method === 'POST' ? {
        body: await request.arrayBuffer(),
      } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'Contact service unavailable.' }, { status: 503 });
  }
}
