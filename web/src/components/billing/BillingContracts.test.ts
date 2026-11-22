import { beforeEach, expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/api', () => ({ request }));
import { fetchPlanCatalog, getBillingAccount, startCheckout, scheduleBillingChange } from '@/lib/billing';
import { catalog, freeAccount } from './fixtures';
beforeEach(() => request.mockReset());
it('preserves the catalog country requirement from the API', async () => {
  request.mockResolvedValue({ ...catalog, billingCountryRequired: true });
  expect(await fetchPlanCatalog(true)).toMatchObject({ billingCountryRequired: true });
});
it('serializes an optional validated ISO country for checkout', async () => {
  request.mockResolvedValue({ url: 'https://payments.example/checkout' });
  await startCheckout({ tier: 'plus', interval: 'month', billingCountry: 'GE' });
  expect(request).toHaveBeenCalledWith('/billing/checkout', expect.objectContaining({ body: { tier: 'plus', interval: 'month', billingCountry: 'GE' } }));
});
it.each(['ZZ', 'ge', 'Georgia', '', 'US,GE'])('rejects invalid checkout country %s before a request', async (billingCountry) => {
  await expect(startCheckout({ tier: 'pro', interval: 'year', billingCountry })).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it('keeps plan changes limited to the original plan choice', async () => {
  const choiceWithCountry = { tier: 'plus', interval: 'month', billingCountry: 'GE' } satisfies Parameters<typeof startCheckout>[0];
  await expect(scheduleBillingChange(choiceWithCountry)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it('preserves billing conflict state and defaults absent legacy state to false', async () => {
  request.mockResolvedValueOnce({ ...freeAccount, billingConflict: true });
  expect(await getBillingAccount()).toMatchObject({ billingConflict: true });
  const withoutConflict = { ...freeAccount };
  Reflect.deleteProperty(withoutConflict, 'billingConflict');
  request.mockResolvedValueOnce(withoutConflict);
  expect(await getBillingAccount()).toMatchObject({ billingConflict: false });
});
