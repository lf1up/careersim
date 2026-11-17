import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { createPolarProvider } from "../src/modules/billing/polar.js";

const config = () =>
  loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
    BILLING_ENABLED: "true",
    POLAR_ACCESS_TOKEN: "fixture-token",
    POLAR_WEBHOOK_SECRET: "fixture-secret",
    POLAR_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
    POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-year",
  });
const checkout = {
  id: "checkout",
  url: "https://checkout.polar.sh/test",
  expires_at: "2026-11-11T00:00:00Z",
  metadata: { careersim_attempt_id: "attempt" },
};
const page = (items: unknown[], maxPage = 1) =>
  Response.json({
    items,
    pagination: { total_count: items.length, max_page: maxPage },
  });
const subscription = {
  id: "subscription",
  customer_id: "customer",
  customer: { external_id: "immutable-user" },
  product_id: "plus-month",
  status: "active",
  ended_at: null,
  created_at: "2026-01-01T00:00:00Z",
  pending_update: null,
  cancel_at_period_end: false,
  current_period_end: "2026-12-01T00:00:00Z",
};
const invoiceLine = {
  proration: false,
  start_timestamp: "2026-11-01T00:00:00Z",
  end_timestamp: "2026-12-01T00:00:00Z",
};
const paidOrder = {
  id: "order",
  checkout_id: "checkout",
  paid: true,
  product_id: "plus-month",
  total_amount: 900,
  refunded_amount: 0,
  refunded_tax_amount: 0,
  currency: "usd",
  items: [invoiceLine],
};
function snapshotTransport({
  subscriptions = [subscription],
  orders = [paidOrder],
  disputes = [],
}: {
  subscriptions?: unknown[];
  orders?: unknown[];
  disputes?: unknown[];
} = {}) {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/subscriptions/") return page(subscriptions);
    if (url.pathname === "/v1/orders/") return page(orders);
    if (url.pathname === "/v1/disputes/") return page(disputes);
    throw new Error(`Unexpected provider request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());
describe("Polar adapter through the installed versioned SDK", () => {
  it("uses trusted checkout identity, API version and next-period change request fields", async () => {
    const calls: Array<{ url: URL; options: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, options) => {
        const url = new URL(String(input));
        calls.push({ url, options: options ?? {} });
        if (url.pathname === "/v1/customer-sessions/")
          return Response.json({
            customer_portal_url: "https://polar.sh/portal",
          });
        return Response.json(checkout);
      }),
    );
    const provider = createPolarProvider(config());
    expect(
      await provider.createCheckout({
        userId: "immutable-user",
        choice: { tier: "plus", interval: "year" },
        attemptId: "attempt",
      }),
    ).toEqual({
      id: "checkout",
      url: checkout.url,
      expiresAt: new Date(checkout.expires_at),
    });
    await provider.scheduleChange({
      subscriptionId: "subscription",
      choice: { tier: "plus", interval: "year" },
    });
    expect(await provider.createPortal("immutable-user")).toEqual({
      url: "https://polar.sh/portal",
    });
    expect(calls[0]?.url.origin).toBe("https://sandbox-api.polar.sh");
    expect(new Headers(calls[0]?.options.headers).get("Polar-Version")).toBe(
      "2026-10",
    );
    expect(JSON.parse(String(calls[0]?.options.body))).toMatchObject({
      products: ["plus-year", "plus-month"],
      external_customer_id: "immutable-user",
      metadata: { careersim_attempt_id: "attempt" },
      allow_trial: false,
      allow_discount_codes: false,
      return_url: "http://localhost:3000/profile?billing=return",
      success_url: "http://localhost:3000/profile?billing=return",
    });
    expect(calls[1]?.url.pathname).toBe("/v1/subscriptions/subscription");
    expect(calls[1]?.options.method).toBe("PATCH");
    expect(JSON.parse(String(calls[1]?.options.body))).toEqual({
      product_id: "plus-year",
      proration_behavior: "next_period",
    });
    expect(JSON.parse(String(calls[2]?.options.body))).toMatchObject({
      external_customer_id: "immutable-user",
    });
  });
  it("offers every available plan with the requested product selected first", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(checkout));
    vi.stubGlobal("fetch", fetcher);
    const settings = {
      ...config(),
      POLAR_PRO_MONTHLY_PRODUCT_ID: "pro-month",
      POLAR_PRO_YEARLY_PRODUCT_ID: "pro-year",
      PRO_CHANNEL_URL: "https://private.example/pro",
    };
    await createPolarProvider(settings).createCheckout({
      userId: "immutable-user",
      choice: { tier: "pro", interval: "year" },
      attemptId: "attempt",
    });
    expect(
      JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).products,
    ).toEqual(["pro-year", "plus-month", "plus-year", "pro-month"]);
    await createPolarProvider({
      ...settings,
      PRO_CHANNEL_URL: "",
    }).createCheckout({
      userId: "immutable-user",
      choice: { tier: "plus", interval: "month" },
      attemptId: "attempt",
    });
    expect(
      JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).products,
    ).toEqual(["plus-month", "plus-year"]);
  });
  it("changes the product on the existing checkout without creating another session", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(checkout));
    vi.stubGlobal("fetch", fetcher);
    const result = await createPolarProvider(config()).updateCheckout({
      checkoutId: "checkout",
      choice: { tier: "plus", interval: "year" },
    });
    expect(result.id).toBe("checkout");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://sandbox-api.polar.sh/v1/checkouts/checkout",
    );
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      product_id: "plus-year",
      allow_trial: false,
      allow_discount_codes: false,
    });
  });
  it.each([403, 409, 422])(
    "keeps a rejected checkout update recoverable for provider status %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () =>
          Response.json({ detail: "Checkout cannot be updated" }, { status }),
        ),
      );
      await expect(
        createPolarProvider(config()).updateCheckout({
          checkoutId: "checkout",
          choice: { tier: "plus", interval: "year" },
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "billing_checkout_conflict",
        extra: { contactUrl: "/contact" },
      });
    },
  );
  it("refuses an unconfigured checkout update before network access", async () => {
    const fetcher = snapshotTransport();
    await expect(
      createPolarProvider(config()).updateCheckout({
        checkoutId: "checkout",
        choice: { tier: "pro", interval: "month" },
      }),
    ).rejects.toThrow("Product is not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400, 500])(
    "propagates unexpected provider status %s when updating checkout",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () =>
          Response.json({ detail: "Unexpected provider failure" }, { status }),
        ),
      );
      await expect(
        createPolarProvider(config()).updateCheckout({
          checkoutId: "checkout",
          choice: { tier: "plus", interval: "year" },
        }),
      ).rejects.toMatchObject({ statusCode: status });
    },
  );
  it("preserves network errors when a checkout update response is lost", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new Error("Connection reset");
      }),
    );
    await expect(
      createPolarProvider(config()).updateCheckout({
        checkoutId: "checkout",
        choice: { tier: "plus", interval: "year" },
      }),
    ).rejects.toMatchObject({
      name: "PolarNetworkError",
      message: expect.stringContaining("Connection reset"),
    });
  });
  it("recovers ambiguous checkouts from every provider page without repeating creation", async () => {
    const pages: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, options) => {
        expect(options?.method).toBe("GET");
        const url = new URL(String(input));
        pages.push(url.searchParams.get("page") ?? "");
        return url.searchParams.get("page") === "1"
          ? page(
              [{ ...checkout, metadata: { careersim_attempt_id: "other" } }],
              2,
            )
          : page([checkout], 2);
      }),
    );
    expect(
      (await createPolarProvider(config()).findCheckout("attempt"))?.id,
    ).toBe("checkout");
    expect(pages).toEqual(["1", "2"]);
  });
  it("normalizes paid invoice periods and refunds while ignoring unpaid subscription cycles", async () => {
    let paid = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/subscriptions/") {
          expect(url.searchParams.get("external_customer_id")).toBe(
            "immutable-user",
          );
          return page([
            {
              id: "subscription",
              customer_id: "customer",
              customer: { external_id: "immutable-user" },
              product_id: "plus-year",
              status: "active",
              ended_at: null,
              created_at: "2026-01-01T00:00:00Z",
              pending_update: null,
              cancel_at_period_end: false,
              current_period_end: "2028-02-29T00:00:00Z",
            },
          ]);
        }
        if (url.pathname === "/v1/orders/")
          return page([
            {
              id: "order",
              checkout_id: "paid-checkout",
              paid,
              product_id: "plus-year",
              total_amount: 9900,
              refunded_amount: 9000,
              refunded_tax_amount: 900,
              currency: "usd",
              items: [
                {
                  proration: false,
                  start_timestamp: "2027-02-28T00:00:00Z",
                  end_timestamp: "2028-02-29T00:00:00Z",
                },
              ],
            },
          ]);
        expect(url.pathname).toBe("/v1/disputes/");
        expect(url.searchParams.get("order_id")).toBe("order");
        return page([{ status: "won" }]);
      }),
    );
    const provider = createPolarProvider(config());
    expect(await provider.fetchSnapshot("immutable-user")).toMatchObject({
      paidPeriod: null,
      orders: [],
    });
    paid = true;
    expect(await provider.fetchSnapshot("immutable-user")).toMatchObject({
      choice: { tier: "plus", interval: "year" },
      paidPeriod: {
        checkoutId: "paid-checkout",
        start: new Date("2027-02-28T00:00:00Z"),
        end: new Date("2028-02-29T00:00:00Z"),
        totalAmount: 9900,
        refundedAmount: 9900,
        dispute: "won",
      },
    });
  });
  it("confirms already-revoked 403 responses before completing durable refund work", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, options) =>
        options?.method === "DELETE"
          ? Response.json({ detail: "already canceled" }, { status: 403 })
          : Response.json({ ended_at: "2026-11-10T00:00:00Z" }),
      ),
    );
    await expect(
      createPolarProvider(config()).revokeSubscription("subscription"),
    ).resolves.toBeUndefined();
  });
  it("retains retryable work when an unsuccessful revoke is still active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, options) =>
        options?.method === "DELETE"
          ? Response.json({ detail: "locked" }, { status: 409 })
          : Response.json({ ended_at: null }),
      ),
    );
    await expect(
      createPolarProvider(config()).revokeSubscription("subscription"),
    ).rejects.toThrow();
  });
  it("returns no subscription when the provider has no customer history", async () => {
    const fetcher = snapshotTransport({ subscriptions: [] });
    expect(
      await createPolarProvider(config()).fetchSnapshot("immutable-user"),
    ).toEqual({ kind: "none" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects multiple live subscriptions instead of selecting arbitrary paid access", async () => {
    snapshotTransport({
      subscriptions: [subscription, { ...subscription, id: "duplicate" }],
    });
    await expect(
      createPolarProvider(config()).fetchSnapshot("immutable-user"),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "billing_duplicate_subscriptions",
    });
  });
  it("rejects a provider customer belonging to another immutable account", async () => {
    const fetcher = snapshotTransport({
      subscriptions: [
        { ...subscription, customer: { external_id: "another-user" } },
      ],
    });
    await expect(
      createPolarProvider(config()).fetchSnapshot("immutable-user"),
    ).rejects.toThrow("Provider customer identity mismatch");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses the newest ended subscription when only historical subscriptions remain", async () => {
    snapshotTransport({
      subscriptions: [
        {
          ...subscription,
          id: "older",
          status: "canceled",
          ended_at: "2026-03-01T00:00:00Z",
        },
        {
          ...subscription,
          id: "newer",
          created_at: "2026-06-01T00:00:00Z",
          status: "canceled",
          ended_at: "2026-07-01T00:00:00Z",
        },
      ],
      orders: [],
    });
    expect(
      await createPolarProvider(config()).fetchSnapshot("immutable-user"),
    ).toMatchObject({
      subscriptionId: "newer",
      revoked: true,
      paidPeriod: null,
    });
  });
  it.each([
    ["missing product", { product_id: null }],
    ["zero total", { total_amount: 0 }],
    ["non-USD currency", { currency: "eur" }],
    ["missing invoice dates", { items: [] }],
    ["proration only", { items: [{ ...invoiceLine, proration: true }] }],
    [
      "conflicting invoice periods",
      {
        items: [
          invoiceLine,
          { ...invoiceLine, end_timestamp: "2027-01-01T00:00:00Z" },
        ],
      },
    ],
    [
      "invalid start date",
      { items: [{ ...invoiceLine, start_timestamp: "invalid" }] },
    ],
    [
      "invalid end date",
      { items: [{ ...invoiceLine, end_timestamp: "invalid" }] },
    ],
    [
      "backward invoice period",
      { items: [{ ...invoiceLine, end_timestamp: "2026-10-01T00:00:00Z" }] },
    ],
  ])(
    "does not treat %s as proof of a paid period",
    async (_label, override) => {
      const fetcher = snapshotTransport({
        orders: [{ ...paidOrder, ...override }],
      });
      expect(
        await createPolarProvider(config()).fetchSnapshot("immutable-user"),
      ).toMatchObject({ paidPeriod: null, orders: [] });
      expect(
        fetcher.mock.calls.every(
          ([input]) => !String(input).includes("/disputes/"),
        ),
      ).toBe(true);
    },
  );
  it.each([
    [[{ status: "prevented" }], "none"],
    [[{ status: "won" }, { status: "needs_response" }], "open"],
    [[{ status: "needs_response" }, { status: "won" }], "open"],
    [[{ status: "lost" }, { status: "won" }], "lost"],
  ])("preserves dispute precedence for %j", async (disputes, expected) => {
    snapshotTransport({ disputes });
    expect(
      await createPolarProvider(config()).fetchSnapshot("immutable-user"),
    ).toMatchObject({ paidPeriod: { dispute: expected } });
  });
  it("selects the newest paid invoice and maps the scheduled next-period product", async () => {
    snapshotTransport({
      subscriptions: [
        {
          ...subscription,
          status: "past_due",
          pending_update: { product_id: "plus-year" },
        },
      ],
      orders: [
        {
          ...paidOrder,
          id: "older",
          items: [{ ...invoiceLine, start_timestamp: "2026-10-01T00:00:00Z" }],
        },
        { ...paidOrder, id: "shorter" },
        {
          ...paidOrder,
          id: "newest",
          product_id: "plus-year",
          items: [{ ...invoiceLine, end_timestamp: "2027-11-01T00:00:00Z" }],
        },
      ],
    });
    expect(
      await createPolarProvider(config()).fetchSnapshot("immutable-user"),
    ).toMatchObject({
      choice: { tier: "plus", interval: "year" },
      paidPeriod: { orderId: "newest" },
      failedRenewal: true,
      pendingChange: {
        choice: { tier: "plus", interval: "year" },
        effectiveAt: new Date("2026-12-01T00:00:00Z"),
      },
    });
  });
  it("refuses checkout before network access when its product is unconfigured", async () => {
    const fetcher = snapshotTransport();
    await expect(
      createPolarProvider(config()).createCheckout({
        userId: "immutable-user",
        choice: { tier: "pro", interval: "month" },
        attemptId: "attempt",
      }),
    ).rejects.toThrow("Product is not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns no recovered checkout when all provider attempts belong to other requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => page([checkout])),
    );
    expect(
      await createPolarProvider(config()).findCheckout("missing-attempt"),
    ).toBeNull();
  });
  it("treats an already-missing subscription as a completed revoke without a follow-up read", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ detail: "not found" }, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createPolarProvider(config()).revokeSubscription("subscription"),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("propagates an unexpected revoke failure without claiming the subscription ended", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ detail: "bad request" }, { status: 400 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createPolarProvider(config()).revokeSubscription("subscription"),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
