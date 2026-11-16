// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';

vi.mock('@/lib/public-api', () => ({ listPublicSimulations: vi.fn() }));
vi.mock('@/components/contact/ContactForm', () => ({ ContactForm: () => null }));
vi.mock('@/lib/ghost', () => ({ isGhostConfigured: vi.fn(), getAllPosts: vi.fn(), getPosts: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@careersim/plugins', () => ({ plugins: [{ id: 'creator', navItems: [], robotsDisallow: ['/create', '/s/', '/analytics'] }] }));

import { listPublicSimulations } from '@/lib/public-api';
import { getAllPosts, getPosts, isGhostConfigured } from '@/lib/ghost';
import { PRIVATE_CRAWL_PATHS, publicCrawlPages } from '@/lib/crawl-pages';
import { pluginRobotsDisallow } from '@/extensions';
import { revalidatePath } from 'next/cache';
import { absoluteUrl } from '@/lib/seo';
import sitemap from './sitemap';
import robots from './robots';
import { GET as llms } from './llms.txt/route';
import { metadata as contactMetadata } from './(public)/contact/page';
import { metadata as pricingMetadata } from './(public)/pricing/page';
import { POST as publishWebhook } from './api/revalidate/route';

beforeEach(() => {
  vi.stubEnv('LANDING_ORIGIN', '');
  vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', 'false');
  vi.stubEnv('NEXT_PUBLIC_BLOG_ENABLED', 'false');
  vi.mocked(isGhostConfigured).mockReturnValue(true);
  vi.mocked(revalidatePath).mockReset();
  vi.mocked(listPublicSimulations).mockReset().mockResolvedValue([
    { slug: 'interview', title: 'Interview', persona_name: 'Alex' },
    { slug: 'interview', title: 'Interview', persona_name: 'Alex' },
    { slug: 'creator:private', title: 'Private', persona_name: 'Alex' },
  ]);
  vi.mocked(getAllPosts).mockReset().mockResolvedValue([
    { id: '1', slug: 'career-advice', title: 'Advice', updated_at: '2026-10-12T10:00:00.000Z' },
    { id: '1', slug: 'career-advice', title: 'Advice', updated_at: '2026-10-12T10:00:00.000Z' },
    { id: '2', slug: 'older-post', title: 'Older', updated_at: 'invalid', published_at: '2026-09-01T10:00:00.000Z' },
    { id: '3', slug: 'undated', title: 'Undated' },
  ]);
  vi.mocked(getPosts).mockReset().mockResolvedValue({ posts: [], pagination: null });
});
afterEach(() => vi.unstubAllEnvs());

describe.each([false, true])('pricing enabled=%s', (pricing) => {
  it.each([false, true])('keeps discovery surfaces aligned with blog enabled=%s', async (blog) => {
    vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', String(pricing));
    vi.stubEnv('NEXT_PUBLIC_BLOG_ENABLED', String(blog));
    const entries = await sitemap();
    const urls = entries.map(entry => entry.url);
    const policy = robots();
    const rules = Array.isArray(policy.rules) ? policy.rules[0] : policy.rules;
    const text = await (await llms()).text();
    expect(urls).toContain(absoluteUrl('/contact'));
    expect(urls.includes(absoluteUrl('/pricing'))).toBe(pricing);
    expect(urls.includes(absoluteUrl('/blog'))).toBe(blog);
    expect(rules.allow).toContain('/contact');
    expect(rules.disallow?.includes('/pricing')).toBe(!pricing);
    expect(rules.disallow?.includes('/blog')).toBe(!blog);
    expect(text).toContain(absoluteUrl('/contact'));
    expect(text.includes(absoluteUrl('/pricing'))).toBe(pricing);
    expect(text.includes(absoluteUrl('/blog'))).toBe(blog);
    if (!blog) {
      expect(getAllPosts).not.toHaveBeenCalled();
      expect(getPosts).not.toHaveBeenCalled();
    }
  });
});

it.each([false, true])('only advertises landing pages when the landing proxy is configured=%s', async (landing) => {
  vi.stubEnv('LANDING_ORIGIN', landing ? 'http://landing.internal' : '');
  const urls = (await sitemap()).map(entry => entry.url);
  const text = await (await llms()).text();
  for (const path of ['/', '/business', '/privacy', '/terms', '/security']) {
    expect(urls.includes(absoluteUrl(path))).toBe(landing);
  }
  expect(text.includes(absoluteUrl('/business'))).toBe(landing);
  expect(text.includes(absoluteUrl('/privacy'))).toBe(landing);
});

it('keeps private and API routes out of discovery while retaining public sign-in and signup', async () => {
  const entries = await sitemap();
  const policy = robots();
  const rules = Array.isArray(policy.rules) ? policy.rules[0] : policy.rules;
  for (const path of ['/dashboard', '/profile', '/analytics', '/sessions', '/forgot-password', '/reset-password', '/auth/', '/api/', '/create', '/s/']) {
    expect(entries.some(entry => new URL(entry.url).pathname.startsWith(path))).toBe(false);
    expect(rules.disallow).toContain(path);
  }
  expect(new Set(rules.disallow).size).toBe(rules.disallow?.length);
  expect(entries.map(entry => entry.url)).toEqual(expect.arrayContaining([absoluteUrl('/login'), absoluteUrl('/register')]));
  expect(entries.some(entry => entry.url.includes('private'))).toBe(false);
  expect(await (await llms()).text()).not.toContain('creator');
});

it('deduplicates canonical URLs and uses known publication dates instead of generation time', async () => {
  vi.stubEnv('NEXT_PUBLIC_BLOG_ENABLED', 'true');
  const entries = await sitemap();
  expect(new Set(entries.map(entry => entry.url)).size).toBe(entries.length);
  expect(entries.find(entry => entry.url.endsWith('/career-advice'))?.lastModified).toEqual(new Date('2026-10-12T10:00:00.000Z'));
  expect(entries.find(entry => entry.url.endsWith('/older-post'))?.lastModified).toEqual(new Date('2026-09-01T10:00:00.000Z'));
  expect(entries.filter(entry => !entry.url.endsWith('/career-advice') && !entry.url.endsWith('/older-post')).every(entry => entry.lastModified === undefined)).toBe(true);
});

it('gives Contact and Pricing their own canonical URLs', () => {
  expect(contactMetadata.alternates?.canonical).toBe(absoluteUrl('/contact'));
  expect(pricingMetadata.alternates?.canonical).toBe(absoluteUrl('/pricing'));
});

it('does not advertise blog routes before Ghost is configured', async () => {
  vi.stubEnv('NEXT_PUBLIC_BLOG_ENABLED', 'true');
  vi.mocked(isGhostConfigured).mockReturnValue(false);
  expect((await sitemap()).some(entry => new URL(entry.url).pathname.startsWith('/blog'))).toBe(false);
  expect(await (await llms()).text()).not.toContain(absoluteUrl('/blog'));
  expect(getAllPosts).not.toHaveBeenCalled();
  expect(getPosts).not.toHaveBeenCalled();
});

it('classifies every current page route as public, private, or dynamic public content', () => {
  vi.stubEnv('LANDING_ORIGIN', 'http://landing.internal');
  vi.stubEnv('NEXT_PUBLIC_BLOG_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', 'true');
  const publicPaths = new Set([...publicCrawlPages().map(page => page.path), '/simulations/[slug]', '/blog/[slug]']);
  const privatePrefixes = [...PRIVATE_CRAWL_PATHS, ...pluginRobotsDisallow()].map(path => path.replace(/\/$/, ''));
  const files = readdirSync(new URL('.', import.meta.url), { recursive: true });
  for (const file of files) {
    if (typeof file !== 'string' || !/(^|\/)page\.tsx$/.test(file)) continue;
    const route = '/' + file.split('/').slice(0, -1).filter(part => !part.startsWith('(')).join('/');
    expect(publicPaths.has(route) || privatePrefixes.some(prefix => route === prefix || route.startsWith(prefix + '/')), `Unclassified page route: ${route}`).toBe(true);
  }
});

it('refreshes sitemap and LLM discovery together after a Ghost publication', async () => {
  vi.stubEnv('NEXT_PUBLIC_BLOG_ENABLED', 'true');
  vi.stubEnv('GHOST_WEBHOOK_SECRET', 'test-publish-secret');
  const response = await publishWebhook(new Request('https://careersim.local/api/revalidate?secret=test-publish-secret', {
    method: 'POST', body: JSON.stringify({ post: { current: { slug: 'new' }, previous: { slug: 'old' } } }),
  }));
  expect(response.status).toBe(200);
  expect(vi.mocked(revalidatePath).mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['/blog', '/blog/new', '/blog/old', '/sitemap.xml', '/llms.txt']));
  expect((await response.json()).paths).toContain('/llms.txt');
});
