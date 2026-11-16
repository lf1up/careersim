import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/billing', async (original) => ({
  ...await original<typeof import('@/lib/billing')>(),
  fetchPlanCatalog: vi.fn(),
}));

import { fetchPlanCatalog } from '@/lib/billing';
import { catalog } from '@/components/billing/fixtures';
import { PricingPage } from '@/components/billing/PricingPage';
import Pricing from './page';

beforeEach(() => {
  vi.mocked(fetchPlanCatalog).mockReset().mockResolvedValue(catalog);
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, '', 'false', '0'])('returns 404 without fetching plans when pricing is disabled with %s', async (value) => {
  vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', value);
  await expect(Pricing({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  expect(fetchPlanCatalog).not.toHaveBeenCalled();
});

it.each(['true', '1'])('keeps pricing available when the flag is %s', async (value) => {
  vi.stubEnv('NEXT_PUBLIC_PRICING_ENABLED', value);
  const page = await Pricing({ searchParams: Promise.resolve({ interval: 'year' }) });
  expect(page.type).toBe(PricingPage);
  expect(page.props.initialInterval).toBe('year');
});
