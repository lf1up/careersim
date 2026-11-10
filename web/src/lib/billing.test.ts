import { afterEach, expect, it, vi } from 'vitest';
import { catalog, freeAccount } from '@/components/billing/fixtures';
import { fetchPlanCatalog, getBillingAccount, startCheckout, createBillingPortal, getSupporterAccess, scheduleBillingChange } from './billing';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('validates a public catalog, caches briefly and refreshes before purchase', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog)));
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchPlanCatalog(true)).toEqual(catalog);
  await fetchPlanCatalog();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ plans: [] })));
  await expect(fetchPlanCatalog(true)).rejects.toThrow();
});
it('uses prefixed cookie-authenticated billing routes and rejects malformed responses', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example/v4/');
  const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/account') ? freeAccount : { url: 'https://polar.example/checkout' }))));
  vi.stubGlobal('fetch', fetcher);
  await expect(getBillingAccount()).resolves.toEqual(freeAccount);
  await startCheckout({ tier: 'plus', interval: 'year' });
  expect(fetcher).toHaveBeenLastCalledWith('https://api.example/v4/billing/checkout', expect.objectContaining({ credentials: 'include', body: JSON.stringify({ tier: 'plus', interval: 'year' }), method: 'POST' }));
  fetcher.mockResolvedValue(new Response(JSON.stringify({ url: 'javascript:alert(1)' })));
  await expect(createBillingPortal()).rejects.toThrow();
});
it('validates supporter links and scheduled dates at the network boundary', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ channelUrl: 'javascript:alert(1)', instructions: 'Join' })));
  vi.stubGlobal('fetch', fetcher);
  await expect(getSupporterAccess()).rejects.toThrow();
  fetcher.mockResolvedValue(new Response(JSON.stringify({ choice: { tier: 'plus', interval: 'year' }, effectiveAt: 'invalid' })));
  await expect(scheduleBillingChange({ tier: 'plus', interval: 'year' })).rejects.toThrow();
});
