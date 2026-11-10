import { describe, expect, it, vi } from 'vitest';

import { checkBillingCatalog, expectedProducts, runBillingCatalogCheck } from '../scripts/check-billing-catalog.js';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const configured = Object.fromEntries(expectedProducts.map(({ key }, index) => [key, ids[index]]));

function product(id: string) {
  const expected = expectedProducts[ids.indexOf(id)];
  if (!expected) throw new Error('Unknown fixture');
  return {
    id, is_archived: false, is_recurring: true,
    recurring_interval: expected.interval, recurring_interval_count: 1,
    trial_interval: null, trial_interval_count: null,
    prices: [{ is_archived: false, amount_type: 'fixed', price_amount: expected.cents,
      price_currency: 'usd', tax_behavior: 'exclusive' }],
  };
}

describe('read-only billing catalog check', () => {
  it('accepts exactly the four approved prices and intervals', async () => {
    const result = await checkBillingCatalog(configured, async (id) => product(id));
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(4);
  });

  it.each([
    ['wrong amount', (p: ReturnType<typeof product>) => { p.prices[0]!.price_amount = 1; }],
    ['wrong currency', (p: ReturnType<typeof product>) => { p.prices[0]!.price_currency = 'eur'; }],
    ['location tax', (p: ReturnType<typeof product>) => { p.prices[0]!.tax_behavior = 'location'; }],
    ['inclusive tax', (p: ReturnType<typeof product>) => { p.prices[0]!.tax_behavior = 'inclusive'; }],
    ['wrong cadence', (p: ReturnType<typeof product>) => { p.recurring_interval_count = 2; }],
    ['wrong interval', (p: ReturnType<typeof product>) => { p.recurring_interval = 'week'; }],
    ['archived', (p: ReturnType<typeof product>) => { p.is_archived = true; }],
    ['one-time', (p: ReturnType<typeof product>) => { p.is_recurring = false; }],
    ['custom price', (p: ReturnType<typeof product>) => { p.prices[0]!.amount_type = 'custom'; }],
    ['extra price', (p: ReturnType<typeof product>) => { p.prices.push({ ...p.prices[0]! }); }],
  ])('rejects %s without printing provider values', async (_label, change) => {
    const result = await checkBillingCatalog(configured, async (id) => {
      const data = product(id);
      change(data);
      return data;
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).not.toContain(ids[0]);
  });

  it('ignores archived historical prices with inherited tax behavior', async () => {
    const result = await checkBillingCatalog(configured, async (id) => {
      const data = product(id);
      return { ...data, prices: [...data.prices, {
        is_archived: true, amount_type: 'fixed', price_amount: 1,
        price_currency: 'eur', tax_behavior: null,
      }] };
    });
    expect(result.ok).toBe(true);
  });

  it('rejects inherited organization tax behavior', async () => {
    const result = await checkBillingCatalog(configured, async (id) => {
      const data = product(id);
      return { ...data, prices: data.prices.map((price) => ({ ...price, tax_behavior: null })) };
    });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain('tax behavior must be exclusive');
  });

  it('rejects trial configuration and malformed responses', async () => {
    expect((await checkBillingCatalog(configured, async (id) => ({ ...product(id), trial_interval: 'day' }))).ok).toBe(false);
    expect((await checkBillingCatalog(configured, async () => ({ secret: 'private' }))).lines.join('\n')).not.toContain('private');
  });

  it('rejects missing, invalid and duplicate mappings before making requests', async () => {
    const read = vi.fn();
    expect((await checkBillingCatalog({}, read)).ok).toBe(false);
    expect((await checkBillingCatalog({ ...configured, POLAR_PLUS_MONTHLY_PRODUCT_ID: 'invalid' }, read)).ok).toBe(false);
    expect((await checkBillingCatalog({ ...configured, POLAR_PLUS_MONTHLY_PRODUCT_ID: ids[1] }, read)).ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('reports failures without echoing provider error bodies, IDs or tokens', async () => {
    const result = await checkBillingCatalog(configured, async () => { throw new Error('token customer@example.com'); });
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).not.toMatch(/token|customer@example/);
  });

  it('only sends GET to the selected fixed Polar host and refuses redirects', async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify(product(url.pathname.split('/').at(-1)!)));
    });
    const result = await runBillingCatalogCheck({ ...configured, POLAR_ACCESS_TOKEN: 'secret' }, request);
    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(4);
    for (const [url, options] of request.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/sandbox-api\.polar\.sh\/v1\/products\//);
      expect(options?.method).toBe('GET');
      expect(options?.redirect).toBe('error');
      expect(new Headers(options?.headers).get('Polar-Version')).toBe('2026-10');
    }
    await runBillingCatalogCheck({ ...configured, POLAR_ACCESS_TOKEN: 'secret', POLAR_ENVIRONMENT: 'production' }, request);
    expect(String(request.mock.calls.at(-1)?.[0])).toMatch(/^https:\/\/api\.polar\.sh\//);
  });

  it('refuses missing credentials or an unrecognized environment without requests', async () => {
    const request = vi.fn<typeof fetch>();
    expect((await runBillingCatalogCheck(configured, request)).ok).toBe(false);
    expect((await runBillingCatalogCheck({ ...configured, POLAR_ACCESS_TOKEN: 'secret', POLAR_ENVIRONMENT: 'evil' }, request)).ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
