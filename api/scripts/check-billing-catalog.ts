/** Read-only enabled-provider catalog audit. Never prints provider bodies, IDs, or credentials. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";
import {
  billingPricesSchema,
  tierEnvironmentMigrationError,
} from "../src/modules/billing/prices.js";

export const expectedProducts = [
  {
    key: "POLAR_PLUS_MONTHLY_PRODUCT_ID",
    tier: "plus",
    interval: "month",
    priceKey: "PLUS_MONTHLY_PRICE_CENTS",
  },
  {
    key: "POLAR_PLUS_YEARLY_PRODUCT_ID",
    tier: "plus",
    interval: "year",
    priceKey: "PLUS_YEARLY_PRICE_CENTS",
  },
  {
    key: "POLAR_PRO_MONTHLY_PRODUCT_ID",
    tier: "pro",
    interval: "month",
    priceKey: "PRO_MONTHLY_PRICE_CENTS",
  },
  {
    key: "POLAR_PRO_YEARLY_PRODUCT_ID",
    tier: "pro",
    interval: "year",
    priceKey: "PRO_YEARLY_PRICE_CENTS",
  },
] satisfies Array<{
  key: string;
  tier: string;
  interval: string;
  priceKey: keyof z.infer<typeof billingPricesSchema>;
}>;

type Provider = "creem" | "polar";

const ProductSchema = z.object({
  id: z.string(),
  is_archived: z.boolean(),
  is_recurring: z.boolean(),
  recurring_interval: z.string().nullable(),
  recurring_interval_count: z.number().int().nullable(),
  trial_interval: z.string().nullable().optional(),
  trial_interval_count: z.number().nullable().optional(),
  prices: z.array(
    z.object({
      is_archived: z.boolean(),
      amount_type: z.string(),
      price_amount: z.number().int().optional(),
      price_currency: z.string(),
      tax_behavior: z.string().nullable(),
      recurring_interval: z.string().nullable().optional(),
    }),
  ),
});

const CreemProductSchema = z.object({
  id: z.string(),
  status: z.string(),
  billing_type: z.string(),
  billing_period: z.string(),
  recurring_interval: z.string().nullable(),
  recurring_interval_count: z.number().int().nullable(),
  price: z.number().int(),
  currency: z.string(),
  tax_mode: z.string().nullable(),
  trial_period_days: z.number().nullable().optional(),
  trial_price: z.number().nullable().optional(),
  usage_prices: z.array(z.unknown()).default([]),
});

type Report = { ok: boolean; lines: string[] };
type FetchProduct = (id: string) => Promise<unknown>;

/** Only allow known mismatch labels into output; provider values stay private. */
export async function checkBillingCatalog(
  source: NodeJS.ProcessEnv,
  fetchProduct: FetchProduct,
  provider: Provider,
): Promise<Report> {
  if (provider !== "creem" && provider !== "polar")
    return {
      ok: false,
      lines: ["catalog: unknown provider; no requests made"],
    };
  if (tierEnvironmentMigrationError(source))
    return {
      ok: false,
      lines: [
        "catalog: legacy tier settings must migrate to PLUS_ and PRO_ settings; no requests made",
      ],
    };
  const configuredPrices = billingPricesSchema.safeParse(source);
  if (!configuredPrices.success)
    return {
      ok: false,
      lines: [
        "catalog: prices must be positive integer USD cents; no requests made",
      ],
    };
  const lines: string[] = [];
  const products = expectedProducts.map((expected) => ({
    ...expected,
    key:
      provider === "creem"
        ? expected.key.replace("POLAR_", "CREEM_")
        : expected.key,
  }));
  const ids = products.map(({ key }) => source[key]?.trim() ?? "");
  for (const [index, expected] of products.entries()) {
    const id = ids[index];
    const validId =
      provider === "creem"
        ? /^prod_[A-Za-z0-9]+$/.test(id ?? "")
        : z.uuid().safeParse(id).success;
    if (!id || !validId) {
      lines.push(
        `${expected.tier}/${expected.interval}: missing or invalid ${expected.key}`,
      );
    }
  }
  if (new Set(ids).size !== ids.length)
    lines.push("catalog: product mappings must be distinct");
  if (lines.length) return { ok: false, lines };

  for (const [index, expected] of products.entries()) {
    const id = ids[index];
    if (!id) throw new Error("Validated product mapping missing");
    const prefix = `${expected.tier}/${expected.interval}`;
    try {
      const data = await fetchProduct(id);
      if (provider === "creem") {
        const result = CreemProductSchema.safeParse(data);
        if (!result.success) {
          lines.push(`${prefix}: invalid provider product response`);
          continue;
        }
        const product = result.data;
        const mismatches: string[] = [];
        if (product.id !== id) mismatches.push("product identity");
        if (product.status !== "active")
          mismatches.push("active product required");
        if (product.billing_type !== "recurring")
          mismatches.push("recurring product required");
        if (
          product.billing_period !== `every-${expected.interval}` ||
          product.recurring_interval !== expected.interval
        )
          mismatches.push("billing interval");
        if (product.recurring_interval_count !== 1)
          mismatches.push("interval count must be 1");
        if (product.trial_period_days != null || product.trial_price != null)
          mismatches.push("trials prohibited");
        const expectedCents = configuredPrices.data[expected.priceKey];
        if (product.price !== expectedCents)
          mismatches.push(`amount must be ${expectedCents} cents`);
        if (product.currency !== "USD") mismatches.push("currency must be USD");
        if (product.tax_mode !== "exclusive")
          mismatches.push("tax behavior must be exclusive");
        if (product.usage_prices.length)
          mismatches.push("metered prices prohibited");
        lines.push(
          `${prefix}: ${mismatches.length ? `MISMATCH ${mismatches.join(", ")}` : "OK"}`,
        );
        continue;
      }
      const result = ProductSchema.safeParse(data);
      if (!result.success) {
        lines.push(`${prefix}: invalid provider product response`);
        continue;
      }
      const product = result.data;
      const mismatches: string[] = [];
      if (product.id !== id) mismatches.push("product identity");
      if (product.is_archived) mismatches.push("archived product");
      if (!product.is_recurring) mismatches.push("recurring product required");
      if (product.recurring_interval !== expected.interval)
        mismatches.push("billing interval");
      if (product.recurring_interval_count !== 1)
        mismatches.push("interval count must be 1");
      if (
        product.trial_interval != null ||
        product.trial_interval_count != null
      )
        mismatches.push("trials prohibited");
      const prices = product.prices.filter((price) => !price.is_archived);
      if (prices.length !== 1) {
        mismatches.push("exactly one active fixed price required");
      } else {
        const price = prices[0];
        if (!price) throw new Error("Active price missing");
        if (price.amount_type !== "fixed")
          mismatches.push("fixed amount required");
        const expectedCents = configuredPrices.data[expected.priceKey];
        if (price.price_amount !== expectedCents)
          mismatches.push(`amount must be ${expectedCents} cents`);
        if (price.price_currency !== "usd")
          mismatches.push("currency must be USD");
        if (price.tax_behavior !== "exclusive")
          mismatches.push("tax behavior must be exclusive");
        if (
          price.recurring_interval != null &&
          price.recurring_interval !== expected.interval
        ) {
          mismatches.push("legacy price interval");
        }
      }
      lines.push(
        `${prefix}: ${mismatches.length ? `MISMATCH ${mismatches.join(", ")}` : "OK"}`,
      );
    } catch {
      lines.push(
        `${prefix}: provider read failed; inspect credentials, environment and connectivity privately`,
      );
    }
  }
  return { ok: lines.every((line) => line.endsWith(": OK")), lines };
}

export async function runBillingCatalogCheck(
  source: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
): Promise<Report> {
  const enabled = z
    .object({
      CREEM_ENABLED: z.enum(["true", "false", "1", "0"]).default("true"),
      POLAR_ENABLED: z.enum(["true", "false", "1", "0"]).default("false"),
    })
    .safeParse(source);
  if (!enabled.success)
    return {
      ok: false,
      lines: [
        "catalog: provider enabled flags must be true, false, 1 or 0; no requests made",
      ],
    };
  const providers: Provider[] = [];
  if (
    enabled.data.CREEM_ENABLED === "true" ||
    enabled.data.CREEM_ENABLED === "1"
  )
    providers.push("creem");
  if (
    enabled.data.POLAR_ENABLED === "true" ||
    enabled.data.POLAR_ENABLED === "1"
  )
    providers.push("polar");
  const lines: string[] = [];
  let ok = true;
  for (const provider of providers) {
    const prefix = provider === "creem" ? "CREEM" : "POLAR";
    const credentialKey =
      provider === "creem" ? "CREEM_API_KEY" : "POLAR_ACCESS_TOKEN";
    const token = source[credentialKey]?.trim();
    const server = source[`${prefix}_ENVIRONMENT`] ?? "sandbox";
    if (!token) {
      ok = false;
      lines.push(`${provider}: ${credentialKey} is required; no requests made`);
      continue;
    }
    if (server !== "sandbox" && server !== "production") {
      ok = false;
      lines.push(
        `${provider}: ${prefix}_ENVIRONMENT must be sandbox or production; no requests made`,
      );
      continue;
    }
    const base =
      provider === "creem"
        ? server === "sandbox"
          ? "https://test-api.creem.io"
          : "https://api.creem.io"
        : server === "sandbox"
          ? "https://sandbox-api.polar.sh"
          : "https://api.polar.sh";
    const headers =
      provider === "creem"
        ? { "x-api-key": token, Accept: "application/json" }
        : {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Polar-Version": "2026-10",
          };
    const report = await checkBillingCatalog(
      source,
      async (id) => {
        const response = await request(
          `${base}/v1/products/${encodeURIComponent(id)}`,
          {
            method: "GET",
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!response.ok) throw new Error("Provider read failed");
        return response.json();
      },
      provider,
    );
    ok = ok && report.ok;
    lines.push(...report.lines.map((line) => `${provider}/${line}`));
  }
  return { ok, lines };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runBillingCatalogCheck(process.env)
    .then((report) => {
      process.stdout.write(`${report.lines.join("\n")}\n`);
      process.exitCode = report.ok ? 0 : 1;
    })
    .catch(() => {
      process.stderr.write(
        "catalog: validation failed; no provider data logged\n",
      );
      process.exitCode = 1;
    });
}
