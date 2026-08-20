import { describe, expect, it } from 'vitest';

import {
  buildLandingOriginUrl,
  headersForApexFromLanding,
  isLandingProxyPath,
  requestHeadersForLanding,
} from './landing-proxy';

describe('isLandingProxyPath', () => {
  it.each([
    '/',
    '/business',
    '/business/',
    '/privacy',
    '/terms',
    '/security',
    '/favicon.svg',
    '/_astro/index.B123.js',
    '/avatars/hero.png',
  ])('proxies %s', (pathname) => {
    expect(isLandingProxyPath(pathname)).toBe(true);
  });

  it.each([
    '/simulations',
    '/simulations/behavioral-interview-brenda',
    '/api/contact',
    '/api/altcha-challenge',
    '/dashboard',
    '/login',
    '/blog',
  ])('does not proxy %s', (pathname) => {
    expect(isLandingProxyPath(pathname)).toBe(false);
  });
});

describe('buildLandingOriginUrl', () => {
  it('joins the landing origin with the apex path', () => {
    expect(
      buildLandingOriginUrl('https://landing.example', '/business').href,
    ).toBe('https://landing.example/business');
  });

  it('keeps visitor query params and does not put the bypass on the URL', () => {
    const url = buildLandingOriginUrl(
      'https://landing.example/',
      '/business',
      '?utm=1',
    );
    expect(url.href).toBe('https://landing.example/business?utm=1');
    expect(url.searchParams.has('x-vercel-protection-bypass')).toBe(false);
  });
});

describe('headersForApexFromLanding', () => {
  it('strips x-robots-tag and keeps caching / type headers', () => {
    const source = new Headers({
      'cache-control': 'public, max-age=0, must-revalidate',
      'content-type': 'text/html; charset=utf-8',
      etag: '"abc"',
      'x-robots-tag': 'noindex',
    });

    const headers = headersForApexFromLanding(source);

    expect(headers.get('x-robots-tag')).toBeNull();
    expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(headers.get('etag')).toBe('"abc"');
    expect(headers.get('cache-control')).toBe(
      'public, max-age=0, must-revalidate',
    );
    expect(headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('requestHeadersForLanding', () => {
  it('drops host, cookies, and client bypass headers, then sets the server secret', () => {
    const source = new Headers({
      host: 'careersim.ai',
      cookie: 'session=abc',
      accept: 'text/html',
      'x-vercel-protection-bypass': 'stolen',
    });

    const headers = requestHeadersForLanding(source, ' secret ');

    expect(headers.get('host')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-vercel-protection-bypass')).toBe('secret');
    expect(headers.get('accept')).toBe('text/html');
    expect(headers.get('accept-encoding')).toBe('identity');
  });
});
