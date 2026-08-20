import { type NextRequest, NextResponse } from 'next/server';

import {
  buildLandingOriginUrl,
  headersForApexFromLanding,
  isLandingProxyPath,
  requestHeadersForLanding,
} from '@/lib/landing-proxy';

export async function proxy(request: NextRequest) {
  const origin = process.env.LANDING_ORIGIN?.replace(/\/$/, '');
  if (!origin) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (!isLandingProxyPath(pathname)) return NextResponse.next();

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.next();
  }

  const dest = buildLandingOriginUrl(origin, pathname, search);

  let upstream: Response;
  try {
    upstream = await fetch(dest, {
      method: request.method,
      headers: requestHeadersForLanding(
        request.headers,
        process.env.LANDING_BYPASS_SECRET,
      ),
      redirect: 'manual',
    });
  } catch {
    return new NextResponse('Landing origin unreachable', { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: headersForApexFromLanding(upstream.headers),
  });
}

// Keep in sync with `isLandingProxyPath` in `@/lib/landing-proxy`.
export const config = {
  matcher: [
    '/',
    '/business',
    '/privacy',
    '/terms',
    '/security',
    '/favicon.svg',
    '/_astro/:path*',
    '/avatars/:path*',
  ],
};
