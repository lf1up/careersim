import { describe, expect, it, vi } from "vitest";

import {
  checkBillingCatalog as checkProviderCatalog,
  expectedProducts,
  runBillingCatalogCheck,
} from "../scripts/check-billing-catalog.js";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const configured = {
  CREEM_ENABLED: "false",
  POLAR_ENABLED: "true",
  ...Object.fromEntries(
    expectedProducts.map(({ key }, index) => [key, ids[index]]),
  ),
};
const checkBillingCatalog = (
  source: NodeJS.ProcessEnv,
  read: (id: string) => Promise<unknown>,
) => checkProviderCatalog(source, read, "polar");
const creemIds = [
  "prod_plusMonthly",
  "prod_plusYearly",
  "prod_proMonthly",
  "prod_proYearly",
];
const creemConfigured = {
  CREEM_API_KEY: "private-creem-key",
  ...Object.fromEntries(
    expectedProducts.map(({ key }, index) => [
      key.replace("POLAR_", "CREEM_"),
      creemIds[index],
    ]),
  ),
};
function creemProduct(id: string) {
  const index = creemIds.indexOf(id);
  const interval = index % 2 ? "year" : "month";
  return {
    id,
    mode: "test",
    object: "product",
    name: "Plan",
    description: "Plan subscription",
    price: defaultAmounts[index],
    currency: "USD",
    billing_type: "recurring",
    billing_period: `every-${interval}`,
    status: "active",
    tax_mode: "exclusive",
    tax_category: "saas",
    recurring_interval: interval,
    recurring_interval_count: 1,
    trial_period_days: null,
    trial_price: null,
    usage_prices: [],
  };
}
const defaultAmounts = [900, 9000, 4900, 49000];
const customPricing = {
  PLUS_MONTHLY_PRICE_CENTS: "1200",
  PLUS_YEARLY_PRICE_CENTS: "12000",
  PRO_MONTHLY_PRICE_CENTS: "15000",
  PRO_YEARLY_PRICE_CENTS: "150000",
};
const customAmounts = [1200, 12000, 15000, 150000];

function product(id: string) {
  const expected = expectedProducts[ids.indexOf(id)];
  if (!expected) throw new Error("Unknown fixture");
  return {
    id,
    is_archived: false,
    is_recurring: true,
    recurring_interval: expected.interval,
    recurring_interval_count: 1,
    trial_interval: null,
    trial_interval_count: null,
    prices: [
      {
        is_archived: false,
        amount_type: "fixed",
        price_amount: defaultAmounts[ids.indexOf(id)],
        price_currency: "usd",
        tax_behavior: "exclusive",
      },
    ],
  };
}

describe("read-only billing catalog check", () => {
  it("accepts exactly the four approved prices and intervals", async () => {
    const result = await checkBillingCatalog(configured, async (id) =>
      product(id),
    );
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(4);
  });
  it("audits all four configured prices without requiring unrelated application environment", async () => {
    const result = await checkBillingCatalog(
      { ...configured, ...customPricing },
      async (id) => {
        const data = product(id);
        return {
          ...data,
          prices: data.prices.map((price) => ({
            ...price,
            price_amount: customAmounts[ids.indexOf(id)],
          })),
        };
      },
    );
    expect(result).toEqual({
      ok: true,
      lines: [
        "plus/month: OK",
        "plus/year: OK",
        "pro/month: OK",
        "pro/year: OK",
      ],
    });
  });
  it("rejects provider prices that match the defaults instead of configured amounts", async () => {
    const result = await checkBillingCatalog(
      { ...configured, ...customPricing },
      async (id) => product(id),
    );
    expect(result.ok).toBe(false);
    expect(result.lines).toEqual([
      "plus/month: MISMATCH amount must be 1200 cents",
      "plus/year: MISMATCH amount must be 12000 cents",
      "pro/month: MISMATCH amount must be 15000 cents",
      "pro/year: MISMATCH amount must be 150000 cents",
    ]);
  });
  it.each([
    ["PLUS_MONTHLY_PRICE_CENTS", "0"],
    ["PLUS_YEARLY_PRICE_CENTS", "-12000"],
    ["PRO_MONTHLY_PRICE_CENTS", "15000.5"],
    ["PRO_YEARLY_PRICE_CENTS", "private-invalid-value"],
  ])("rejects invalid %s before any provider requests", async (key, value) => {
    const request = vi.fn<typeof fetch>();
    const result = await runBillingCatalogCheck(
      {
        ...configured,
        ...customPricing,
        [key]: value,
        POLAR_ACCESS_TOKEN: "secret",
      },
      request,
    );
    expect(result.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(result.lines.join("\n")).toContain("price");
    expect(result.lines.join("\n")).not.toContain("private-invalid-value");
  });

  it.each([
    [
      "wrong amount",
      (p: ReturnType<typeof product>) => {
        p.prices[0]!.price_amount = 1;
      },
    ],
    [
      "wrong currency",
      (p: ReturnType<typeof product>) => {
        p.prices[0]!.price_currency = "eur";
      },
    ],
    [
      "location tax",
      (p: ReturnType<typeof product>) => {
        p.prices[0]!.tax_behavior = "location";
      },
    ],
    [
      "inclusive tax",
      (p: ReturnType<typeof product>) => {
        p.prices[0]!.tax_behavior = "inclusive";
      },
    ],
    [
      "wrong cadence",
      (p: ReturnType<typeof product>) => {
        p.recurring_interval_count = 2;
      },
    ],
    [
      "wrong interval",
      (p: ReturnType<typeof product>) => {
        p.recurring_interval = "week";
      },
    ],
    [
      "archived",
      (p: ReturnType<typeof product>) => {
        p.is_archived = true;
      },
    ],
    [
      "one-time",
      (p: ReturnType<typeof product>) => {
        p.is_recurring = false;
      },
    ],
    [
      "custom price",
      (p: ReturnType<typeof product>) => {
        p.prices[0]!.amount_type = "custom";
      },
    ],
    [
      "extra price",
      (p: ReturnType<typeof product>) => {
        p.prices.push({ ...p.prices[0]! });
      },
    ],
  ])("rejects %s without printing provider values", async (_label, change) => {
    const result = await checkBillingCatalog(configured, async (id) => {
      const data = product(id);
      change(data);
      return data;
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).not.toContain(ids[0]);
  });

  it("ignores archived historical prices with inherited tax behavior", async () => {
    const result = await checkBillingCatalog(configured, async (id) => {
      const data = product(id);
      return {
        ...data,
        prices: [
          ...data.prices,
          {
            is_archived: true,
            amount_type: "fixed",
            price_amount: 1,
            price_currency: "eur",
            tax_behavior: null,
          },
        ],
      };
    });
    expect(result.ok).toBe(true);
  });

  it("rejects inherited organization tax behavior", async () => {
    const result = await checkBillingCatalog(configured, async (id) => {
      const data = product(id);
      return {
        ...data,
        prices: data.prices.map((price) => ({ ...price, tax_behavior: null })),
      };
    });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain("tax behavior must be exclusive");
  });

  it("rejects trial configuration and malformed responses", async () => {
    expect(
      (
        await checkBillingCatalog(configured, async (id) => ({
          ...product(id),
          trial_interval: "day",
        }))
      ).ok,
    ).toBe(false);
    expect(
      (
        await checkBillingCatalog(configured, async () => ({
          secret: "private",
        }))
      ).lines.join("\n"),
    ).not.toContain("private");
  });

  it("rejects missing, invalid and duplicate mappings before making requests", async () => {
    const read = vi.fn();
    expect((await checkBillingCatalog({}, read)).ok).toBe(false);
    expect(
      (
        await checkBillingCatalog(
          { ...configured, POLAR_PLUS_MONTHLY_PRODUCT_ID: "invalid" },
          read,
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await checkBillingCatalog(
          { ...configured, POLAR_PLUS_MONTHLY_PRODUCT_ID: ids[1] },
          read,
        )
      ).ok,
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("reports failures without echoing provider error bodies, IDs or tokens", async () => {
    const result = await checkBillingCatalog(configured, async () => {
      throw new Error("token customer@example.com");
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).not.toMatch(/token|customer@example/);
  });

  it("only sends GET to the selected fixed Polar host and refuses redirects", async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      return new Response(
        JSON.stringify(product(url.pathname.split("/").at(-1)!)),
      );
    });
    const result = await runBillingCatalogCheck(
      { ...configured, POLAR_ACCESS_TOKEN: "secret" },
      request,
    );
    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(4);
    for (const [url, options] of request.mock.calls) {
      expect(String(url)).toMatch(
        /^https:\/\/sandbox-api\.polar\.sh\/v1\/products\//,
      );
      expect(options?.method).toBe("GET");
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("Polar-Version")).toBe(
        "2026-10",
      );
    }
    await runBillingCatalogCheck(
      {
        ...configured,
        POLAR_ACCESS_TOKEN: "secret",
        POLAR_ENVIRONMENT: "production",
      },
      request,
    );
    expect(String(request.mock.calls.at(-1)?.[0])).toMatch(
      /^https:\/\/api\.polar\.sh\//,
    );
  });

  it("refuses missing credentials or an unrecognized environment without requests", async () => {
    const request = vi.fn<typeof fetch>();
    expect((await runBillingCatalogCheck(configured, request)).ok).toBe(false);
    expect(
      (
        await runBillingCatalogCheck(
          {
            ...configured,
            POLAR_ACCESS_TOKEN: "secret",
            POLAR_ENVIRONMENT: "evil",
          },
          request,
        )
      ).ok,
    ).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});

it("rejects a legacy tier environment before reading Polar products", async () => {
  const request = vi.fn();
  const result = await runBillingCatalogCheck(
    {
      ...configured,
      POLAR_ACCESS_TOKEN: "fixture-token",
      SUPPORTER_MONTHLY_PRICE_CENTS: "private-value",
    },
    request,
  );
  expect(result.ok).toBe(false);
  expect(result.lines.join("\n")).toContain("PLUS_");
  expect(result.lines.join("\n")).not.toContain("private-value");
  expect(request).not.toHaveBeenCalled();
});

describe("concurrent provider catalog audit", () => {
  it("defaults to Creem and ignores disabled Polar configuration", async () => {
    const request = vi.fn<typeof fetch>(async (input) =>
      Response.json(
        creemProduct(new URL(String(input)).pathname.split("/").at(-1)!),
      ),
    );
    const result = await runBillingCatalogCheck(
      {
        ...creemConfigured,
        POLAR_ENVIRONMENT: "private-invalid",
        POLAR_PLUS_MONTHLY_PRODUCT_ID: "https://private.invalid",
      },
      request,
    );
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(4);
    expect(result.lines.every((line) => line.startsWith("creem/"))).toBe(true);
    expect(request).toHaveBeenCalledTimes(4);
    for (const [input, options] of request.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://test-api.creem.io");
      expect(creemIds).toContain(url.pathname.split("/").at(-1));
      expect(url.pathname.startsWith("/v1/products/")).toBe(true);
      expect(options?.method).toBe("GET");
      expect(options?.redirect).toBe("error");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(options?.headers).get("x-api-key")).toBe(
        "private-creem-key",
      );
    }
  });
  it("audits both enabled providers independently on fixed production hosts", async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const id = url.pathname.split("/").at(-1)!;
      return Response.json(
        url.hostname === "api.creem.io" ? creemProduct(id) : product(id),
      );
    });
    const result = await runBillingCatalogCheck(
      {
        ...configured,
        ...creemConfigured,
        CREEM_ENABLED: "true",
        CREEM_ENVIRONMENT: "production",
        POLAR_ENVIRONMENT: "production",
        POLAR_ACCESS_TOKEN: "private-polar-key",
      },
      request,
    );
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(8);
    expect(request).toHaveBeenCalledTimes(8);
    expect(
      new Set(request.mock.calls.map(([url]) => new URL(String(url)).origin)),
    ).toEqual(new Set(["https://api.creem.io", "https://api.polar.sh"]));
    for (const [input, options] of request.mock.calls) {
      const headers = new Headers(options?.headers);
      if (new URL(String(input)).hostname === "api.polar.sh") {
        expect(headers.get("Authorization")).toBe("Bearer private-polar-key");
        expect(headers.get("Polar-Version")).toBe("2026-10");
        expect(headers.has("x-api-key")).toBe(false);
      } else expect(headers.has("Authorization")).toBe(false);
    }
  });
  it("makes no calls or credential demands for disabled providers", async () => {
    const request = vi.fn<typeof fetch>();
    expect(
      (
        await runBillingCatalogCheck(
          { CREEM_ENABLED: "false", POLAR_ENABLED: "false" },
          request,
        )
      ).ok,
    ).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { CREEM_ENABLED: "private-invalid" },
    { POLAR_ENABLED: "private-invalid" },
    { CREEM_ENVIRONMENT: "private-invalid" },
    { CREEM_API_KEY: "" },
    { CREEM_PLUS_MONTHLY_PRODUCT_ID: "https://private.invalid/product" },
    { CREEM_PLUS_MONTHLY_PRODUCT_ID: "prod_private?secret=private-value" },
    { CREEM_PLUS_MONTHLY_PRODUCT_ID: creemIds[1] },
    { PLUS_MONTHLY_PRICE_CENTS: "0" },
  ])(
    "rejects invalid Creem configuration before requests: %j",
    async (invalid) => {
      const request = vi.fn<typeof fetch>();
      const result = await runBillingCatalogCheck(
        { ...creemConfigured, ...invalid },
        request,
      );
      expect(result.ok).toBe(false);
      expect(request).not.toHaveBeenCalled();
      expect(result.lines.join("\n")).not.toMatch(/private|prod_plus/);
    },
  );
  it.each([
    { id: "private-product" },
    { price: 1 },
    { currency: "EUR" },
    { status: "archived" },
    { billing_type: "onetime" },
    { billing_period: "every-three-months" },
    { recurring_interval: "week" },
    { recurring_interval_count: 2 },
    { recurring_interval_count: null },
    { tax_mode: "inclusive" },
    { tax_mode: null },
    { trial_period_days: 7 },
    { trial_price: 100 },
    { usage_prices: [{ price: 1 }] },
  ])("rejects unsafe Creem catalog differences: %j", async (change) => {
    const result = await checkProviderCatalog(
      creemConfigured,
      async (id) => ({ ...creemProduct(id), ...change }),
      "creem",
    );
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).not.toMatch(/private-product|prod_plus/);
  });
  it("uses shared configured prices for Creem", async () => {
    const result = await checkProviderCatalog(
      { ...creemConfigured, ...customPricing },
      async (id) => ({
        ...creemProduct(id),
        price: customAmounts[creemIds.indexOf(id)],
      }),
      "creem",
    );
    expect(result.ok).toBe(true);
  });
  it.each(["response", "network", "json"])(
    "sanitizes Creem %s failures",
    async (failure) => {
      const request = vi.fn<typeof fetch>(async () => {
        if (failure === "network")
          throw new Error(
            "private-creem-key customer@example.com prod_private",
          );
        return new Response(
          failure === "json"
            ? "private-body"
            : JSON.stringify({ secret: "private-body" }),
          { status: failure === "response" ? 401 : 200 },
        );
      });
      const result = await runBillingCatalogCheck(creemConfigured, request);
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).not.toMatch(
        /private-body|private-creem-key|customer@example|prod_/,
      );
    },
  );
});

it("accepts numeric provider flags consistently with application configuration", async () => {
  const request = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      creemProduct(new URL(String(input)).pathname.split("/").at(-1)!),
    ),
  );
  expect(
    (
      await runBillingCatalogCheck(
        { ...creemConfigured, CREEM_ENABLED: "1", POLAR_ENABLED: "0" },
        request,
      )
    ).ok,
  ).toBe(true);
  expect(request).toHaveBeenCalledTimes(4);
});
