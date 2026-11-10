/** Read-only Polar catalog audit. Never prints provider bodies, IDs, or credentials. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

export const expectedProducts = [
  { key: 'POLAR_PLUS_MONTHLY_PRODUCT_ID', tier: 'plus', interval: 'month', cents: 900 },
  { key: 'POLAR_PLUS_YEARLY_PRODUCT_ID', tier: 'plus', interval: 'year', cents: 9000 },
  { key: 'POLAR_SUPPORTER_MONTHLY_PRODUCT_ID', tier: 'supporter', interval: 'month', cents: 10000 },
  { key: 'POLAR_SUPPORTER_YEARLY_PRODUCT_ID', tier: 'supporter', interval: 'year', cents: 100000 },
] satisfies Array<{ key: string; tier: string; interval: string; cents: number }>;

const ProductSchema = z.object({
  id: z.string(),
  is_archived: z.boolean(),
  is_recurring: z.boolean(),
  recurring_interval: z.string().nullable(),
  recurring_interval_count: z.number().int().nullable(),
  trial_interval: z.string().nullable().optional(),
  trial_interval_count: z.number().nullable().optional(),
  prices: z.array(z.object({
    is_archived: z.boolean(),
    amount_type: z.string(),
    price_amount: z.number().int().optional(),
    price_currency: z.string(),
    tax_behavior: z.string().nullable(),
    recurring_interval: z.string().nullable().optional(),
  })),
});

type Report = { ok: boolean; lines: string[] };
type FetchProduct = (id: string) => Promise<unknown>;

/** Only allow known mismatch labels into output; provider values stay private. */
export async function checkBillingCatalog(
  source: NodeJS.ProcessEnv,
  fetchProduct: FetchProduct,
): Promise<Report> {
  const lines: string[] = [];
  const ids = expectedProducts.map(({ key }) => source[key]?.trim() ?? '');
  for (const [index, expected] of expectedProducts.entries()) {
    const id = ids[index];
    if (!id || !z.uuid().safeParse(id).success) {
      lines.push(`${expected.tier}/${expected.interval}: missing or invalid ${expected.key}`);
    }
  }
  if (new Set(ids).size !== ids.length) lines.push('catalog: product mappings must be distinct');
  if (lines.length) return { ok: false, lines };

  for (const [index, expected] of expectedProducts.entries()) {
    const id = ids[index];
    if (!id) throw new Error('Validated product mapping missing');
    const prefix = `${expected.tier}/${expected.interval}`;
    try {
      const result = ProductSchema.safeParse(await fetchProduct(id));
      if (!result.success) {
        lines.push(`${prefix}: invalid provider product response`);
        continue;
      }
      const product = result.data;
      const mismatches: string[] = [];
      if (product.id !== id) mismatches.push('product identity');
      if (product.is_archived) mismatches.push('archived product');
      if (!product.is_recurring) mismatches.push('recurring product required');
      if (product.recurring_interval !== expected.interval) mismatches.push('billing interval');
      if (product.recurring_interval_count !== 1) mismatches.push('interval count must be 1');
      if (product.trial_interval != null || product.trial_interval_count != null) mismatches.push('trials prohibited');
      const prices = product.prices.filter((price) => !price.is_archived);
      if (prices.length !== 1) {
        mismatches.push('exactly one active fixed price required');
      } else {
        const price = prices[0];
        if (!price) throw new Error('Active price missing');
        if (price.amount_type !== 'fixed') mismatches.push('fixed amount required');
        if (price.price_amount !== expected.cents) mismatches.push(`amount must be ${expected.cents} cents`);
        if (price.price_currency !== 'usd') mismatches.push('currency must be USD');
        if (price.tax_behavior !== 'exclusive') mismatches.push('tax behavior must be exclusive');
        if (price.recurring_interval != null && price.recurring_interval !== expected.interval) {
          mismatches.push('legacy price interval');
        }
      }
      lines.push(`${prefix}: ${mismatches.length ? `MISMATCH ${mismatches.join(', ')}` : 'OK'}`);
    } catch {
      lines.push(`${prefix}: provider read failed; inspect credentials, environment and connectivity privately`);
    }
  }
  return { ok: lines.every((line) => line.endsWith(': OK')), lines };
}

export async function runBillingCatalogCheck(
  source: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
): Promise<Report> {
  const token = source.POLAR_ACCESS_TOKEN?.trim();
  const server = source.POLAR_ENVIRONMENT ?? 'sandbox';
  if (!token) return { ok: false, lines: ['catalog: POLAR_ACCESS_TOKEN is required; no requests made'] };
  if (server !== 'sandbox' && server !== 'production') {
    return { ok: false, lines: ['catalog: POLAR_ENVIRONMENT must be sandbox or production; no requests made'] };
  }
  const base = server === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh';
  return checkBillingCatalog(source, async (id) => {
    const response = await request(`${base}/v1/products/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Polar-Version': '2026-10' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Provider read failed');
    return response.json();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBillingCatalogCheck(process.env).then((report) => {
    process.stdout.write(`${report.lines.join('\n')}\n`);
    process.exitCode = report.ok ? 0 : 1;
  }).catch(() => {
    process.stderr.write('catalog: validation failed; no provider data logged\n');
    process.exitCode = 1;
  });
}
