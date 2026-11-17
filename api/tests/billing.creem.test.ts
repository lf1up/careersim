import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { createCreemProvider } from "../src/modules/billing/creem.js";

const config = () =>
  loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
    CREEM_API_KEY: "fixture-secret",
    CREEM_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
    CREEM_PLUS_YEARLY_PRODUCT_ID: "plus-year",
    CREEM_PRO_MONTHLY_PRODUCT_ID: "pro-month",
    CREEM_PRO_YEARLY_PRODUCT_ID: "pro-year",
  });
const choice = { tier: "plus", interval: "month" } as const;
const references = {
  customerId: "customer",
  subscriptionIds: ["subscription"],
  checkouts: [],
};
const checkout = {
  id: "checkout",
  status: "completed",
  product: "plus-month",
  request_id: "attempt",
  checkout_url: "https://creem.io/test/checkout",
  customer: "customer",
  subscription: "subscription",
  order: { id: "initial-order", product: "plus-month" },
  metadata: { careersim_user_id: "user", careersim_attempt_id: "attempt" },
};
const subscription = {
  id: "subscription",
  customer: "customer",
  product: "plus-month",
  status: "active",
  created_at: "2026-11-01T00:00:00Z",
  current_period_start_date: "2026-11-01T00:00:00Z",
  current_period_end_date: "2026-12-01T00:00:00Z",
  last_transaction_id: "transaction",
};
const transaction = {
  id: "transaction",
  amount: 900,
  amount_paid: 900,
  refunded_amount: 0,
  currency: "USD",
  type: "invoice",
  status: "paid",
  customer: "customer",
  subscription: "subscription",
  order: "order",
  period_start: Date.parse(subscription.current_period_start_date),
  period_end: Date.parse(subscription.current_period_end_date),
};
function transport({
  sub = subscription,
  transactions = [transaction],
  check = checkout,
}: {
  sub?: unknown;
  transactions?: unknown[];
  check?: unknown;
} = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/checkouts") return Response.json(check);
    if (url.pathname === "/v1/subscriptions") return Response.json(sub);
    if (url.pathname === "/v1/transactions/search")
      return Response.json({
        items: transactions,
        pagination: { current_page: 1, next_page: null },
      });
    if (url.pathname === "/v1/customers/billing")
      return Response.json({ customer_portal_link: "https://creem.io/portal" });
    throw new Error(`Unexpected ${url}`);
  });
}

describe("Creem REST billing boundary", () => {
  it("creates checkout with immutable server identity, fixed sandbox host and no invented expiry", async () => {
    const fetcher = transport({ check: { ...checkout, status: "pending" } });
    const result = await createCreemProvider(config(), fetcher).createCheckout({
      userId: "user",
      choice,
      attemptId: "attempt",
    });
    expect(result).toEqual({
      id: "checkout",
      url: checkout.checkout_url,
      expiresAt: null,
      state: "open",
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://test-api.creem.io/v1/checkouts");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(new Headers(init?.headers).get("x-api-key")).toBe("fixture-secret");
    expect(JSON.parse(String(init?.body))).toEqual({
      product_id: "plus-month",
      request_id: "attempt",
      metadata: { careersim_user_id: "user", careersim_attempt_id: "attempt" },
      success_url: "http://localhost:3000/profile?billing=return",
    });
  });
  it("uses production only when explicitly configured", async () => {
    const fetcher = transport();
    await createCreemProvider(
      { ...config(), CREEM_ENVIRONMENT: "production" },
      fetcher,
    ).findCheckout("attempt", "checkout");
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.creem.io/v1/checkouts?checkout_id=checkout",
    );
  });
  it("leaves an ambiguous create unresolved without scanning or replaying POST", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("secret-token request timeout");
    });
    const provider = createCreemProvider(config(), fetcher);
    await expect(
      provider.createCheckout({ userId: "user", choice, attemptId: "attempt" }),
    ).rejects.toMatchObject({
      code: "billing_provider_error",
      statusCode: 502,
    });
    expect(await provider.findCheckout("attempt")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["pending", "open"],
    ["processing", "open"],
    ["completed", "completed"],
    ["expired", "closed"],
  ])("maps checkout %s to %s", async (status, state) => {
    const provider = createCreemProvider(
      config(),
      transport({ check: { ...checkout, status } }),
    );
    expect(await provider.findCheckout("attempt", "checkout")).toMatchObject({
      state,
      expiresAt: null,
    });
  });
  it("rejects a checkout from a different attempt", async () => {
    await expect(
      createCreemProvider(config(), transport()).findCheckout(
        "foreign",
        "checkout",
      ),
    ).rejects.toMatchObject({ code: "billing_identity_mismatch" });
  });
  it("returns confirmed missing checkout only for a GET 404", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ secret: "private" }, { status: 404 }),
    );
    expect(
      await createCreemProvider(config(), fetcher).findCheckout(
        "attempt",
        "missing",
      ),
    ).toBeNull();
  });
  it("does not discover customers through email or store-wide scans", async () => {
    const fetcher = transport();
    expect(
      await createCreemProvider(config(), fetcher).fetchSnapshot("user"),
    ).toEqual({ kind: "none" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("discovers the initial subscription from an owned checkout", async () => {
    const fetcher = transport();
    const result = await createCreemProvider(config(), fetcher).fetchSnapshot(
      "user",
      {
        customerId: null,
        subscriptionIds: [],
        checkouts: [{ attemptId: "attempt", checkoutId: "checkout", choice }],
      },
    );
    expect(result).toMatchObject({
      kind: "subscription",
      customerId: "customer",
      subscriptionId: "subscription",
      paidPeriod: {
        orderId: "transaction",
        start: new Date(transaction.period_start),
        end: new Date(transaction.period_end),
      },
    });
    expect(
      fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual([
      "/v1/checkouts",
      "/v1/subscriptions",
      "/v1/transactions/search",
    ]);
    expect(
      new URL(String(fetcher.mock.calls[2]?.[0])).searchParams.get(
        "customer_id",
      ),
    ).toBe("customer");
  });
  it.each([
    {
      metadata: {
        careersim_user_id: "someone-else",
        careersim_attempt_id: "attempt",
      },
    },
    { request_id: "foreign" },
    { product: "pro-month" },
    { customer: "foreign" },
  ])(
    "rejects a checkout ownership mismatch %j before reading subscriptions",
    async (override) => {
      const fetcher = transport({ check: { ...checkout, ...override } });
      await expect(
        createCreemProvider(config(), fetcher).fetchSnapshot("user", {
          ...references,
          checkouts: [{ attemptId: "attempt", checkoutId: "checkout", choice }],
        }),
      ).rejects.toMatchObject({ code: "billing_identity_mismatch" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("requires stored customer ownership for direct subscriptions", async () => {
    await expect(
      createCreemProvider(
        config(),
        transport({ sub: { ...subscription, customer: "foreign" } }),
      ).fetchSnapshot("user", references),
    ).rejects.toMatchObject({ code: "billing_identity_mismatch" });
  });
  it("active status alone grants no paid period", async () => {
    expect(
      await createCreemProvider(
        config(),
        transport({ transactions: [] }),
      ).fetchSnapshot("user", references),
    ).toMatchObject({ status: "active", paidPeriod: null, orders: [] });
  });
  it("normalizes null refund amounts only for authoritative paid transactions", async () => {
    expect(
      await createCreemProvider(
        config(),
        transport({
          transactions: [{ ...transaction, refunded_amount: null }],
        }),
      ).fetchSnapshot("user", references),
    ).toMatchObject({
      paidPeriod: { totalAmount: 900, refundedAmount: 0 },
    });
  });
  it("accepts null subscription metadata without weakening stored customer ownership", async () => {
    expect(
      await createCreemProvider(
        config(),
        transport({
          sub: { ...subscription, metadata: null },
        }),
      ).fetchSnapshot("user", references),
    ).toMatchObject({ customerId: "customer" });
  });
  it.each(["GE", "US"])(
    "returns provider-confirmed customer country %s",
    async (country) => {
      expect(
        await createCreemProvider(
          config(),
          transport({
            sub: { ...subscription, customer: { id: "customer", country } },
          }),
        ).fetchSnapshot("user", references),
      ).toMatchObject({ billingCountry: country });
    },
  );
  it.each([undefined, null, "", "XX", "ge", 123])(
    "omits unknown provider country %j",
    async (country) => {
      const snapshot = await createCreemProvider(
        config(),
        transport({
          sub: { ...subscription, customer: { id: "customer", country } },
        }),
      ).fetchSnapshot("user", references);
      expect(snapshot).not.toHaveProperty("billingCountry");
      expect(snapshot).toMatchObject({ customerId: "customer" });
    },
  );
  it("refreshes historical refunds and disputes using persisted immutable payment identity", async () => {
    const provider = createCreemProvider(
      config(),
      transport({
        sub: {
          ...subscription,
          product: "pro-month",
          current_period_start_date: "2026-12-01T00:00:00Z",
          current_period_end_date: "2027-01-01T00:00:00Z",
        },
        transactions: [
          { ...transaction, status: "refunded", refunded_amount: 900 },
        ],
      }),
    );
    expect(
      await provider.fetchSnapshot("user", {
        ...references,
        orders: [
          {
            orderId: transaction.id,
            productId: "plus-month",
            subscriptionId: "subscription",
            start: new Date(transaction.period_start),
            end: new Date(transaction.period_end),
          },
        ],
      }),
    ).toMatchObject({
      choice,
      paidPeriod: { productId: "plus-month", refundedAmount: 900 },
    });
  });
  it("rejects changes to the immutable period of an already verified transaction", async () => {
    const provider = createCreemProvider(config(), transport());
    await expect(
      provider.fetchSnapshot("user", {
        ...references,
        orders: [
          {
            orderId: transaction.id,
            productId: "plus-month",
            subscriptionId: "subscription",
            start: new Date(transaction.period_start),
            end: new Date("2027-12-01T00:00:00Z"),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "billing_identity_mismatch" });
  });
  it.each(["canceled", "scheduled_cancel"])(
    "preserves verified paid-through for %s",
    async (status) => {
      expect(
        await createCreemProvider(
          config(),
          transport({ sub: { ...subscription, status } }),
        ).fetchSnapshot("user", references),
      ).toMatchObject({
        paidPeriod: { totalAmount: 900 },
        revoked: false,
        cancelAtPeriodEnd: true,
      });
    },
  );
  it.each([
    ["refunded", 900, "none"],
    ["partialRefund", 100, "none"],
    ["partially_refunded", 100, "none"],
    ["chargeback", 0, "open"],
    ["chargedBack", 0, "open"],
  ])(
    "normalizes %s using actual paid amount and refund evidence",
    async (status, refund, dispute) => {
      expect(
        await createCreemProvider(
          config(),
          transport({
            transactions: [{ ...transaction, status, refunded_amount: refund }],
          }),
        ).fetchSnapshot("user", references),
      ).toMatchObject({
        paidPeriod: { totalAmount: 900, refundedAmount: refund, dispute },
      });
    },
  );
  it.each([
    { status: "pending" },
    { amount_paid: 0 },
    { currency: "EUR" },
    { period_start: null },
    { period_end: transaction.period_start },
    { period_end: 99999999999999999 },
    { refunded_amount: -1 },
    { refunded_amount: 1000 },
    { status: "refunded", refunded_amount: null },
    { status: "refunded", refunded_amount: 0 },
    { status: "refunded", refunded_amount: 100 },
    { status: "partialRefund", refunded_amount: null },
    { status: "partially_refunded", refunded_amount: null },
    { status: "partialRefund", refunded_amount: 0 },
    { type: "payment" },
    { amount: -1 },
    { amount: 1.5 },
    { id: "historical", order: "unknown-order" },
  ])("does not treat unproven payment %j as access", async (override) => {
    expect(
      await createCreemProvider(
        config(),
        transport({ transactions: [{ ...transaction, ...override }] }),
      ).fetchSnapshot("user", references),
    ).toMatchObject({ paidPeriod: null, orders: [] });
  });
  it("rejects foreign transactions even when the requested customer filter was correct", async () => {
    await expect(
      createCreemProvider(
        config(),
        transport({ transactions: [{ ...transaction, customer: "foreign" }] }),
      ).fetchSnapshot("user", references),
    ).rejects.toMatchObject({ code: "billing_identity_mismatch" });
  });
  it("does not relabel historical payments with the mutable current product", async () => {
    const fetcher = transport({
      sub: { ...subscription, product: "pro-month" },
      transactions: [
        { ...transaction, id: "historical", order: "initial-order" },
      ],
    });
    expect(
      await createCreemProvider(config(), fetcher).fetchSnapshot("user", {
        ...references,
        checkouts: [{ attemptId: "attempt", checkoutId: "checkout", choice }],
      }),
    ).toMatchObject({
      productId: "pro-month",
      choice,
      paidPeriod: { productId: "plus-month" },
    });
  });
  it("exhausts customer transaction pagination and deduplicates transactions", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/subscriptions")
        return Response.json(subscription);
      const page = Number(url.searchParams.get("page_number"));
      return Response.json({
        items: page === 1 ? [] : [transaction, transaction],
        pagination: { current_page: page, next_page: page === 1 ? 2 : null },
      });
    });
    expect(
      await createCreemProvider(config(), fetcher).fetchSnapshot(
        "user",
        references,
      ),
    ).toMatchObject({ orders: [{ orderId: "transaction" }] });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("rejects multiple live subscriptions", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      Response.json({
        ...subscription,
        id: new URL(String(input)).searchParams.get("subscription_id"),
      }),
    );
    await expect(
      createCreemProvider(config(), fetcher).fetchSnapshot("user", {
        ...references,
        subscriptionIds: ["one", "two"],
      }),
    ).rejects.toMatchObject({ code: "billing_duplicate_subscriptions" });
  });
  it("uses only the customer mapping verified by a successful snapshot for portal access", async () => {
    const fetcher = transport();
    const provider = createCreemProvider(config(), fetcher);
    await expect(provider.createPortal("user")).rejects.toMatchObject({
      code: "billing_customer_missing",
    });
    await provider.fetchSnapshot("user", references);
    expect(await provider.createPortal("user")).toEqual({
      url: "https://creem.io/portal",
    });
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({
      customer_id: "customer",
    });
    await expect(provider.createPortal("foreign-user")).rejects.toMatchObject({
      code: "billing_customer_missing",
    });
  });
  it("cancels immediately using documented POST fields and exposes no plan switching", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ ...subscription, status: "canceled" }),
    );
    const provider = createCreemProvider(config(), fetcher);
    await provider.revokeSubscription("subscription");
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://test-api.creem.io/v1/subscriptions/subscription/cancel",
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      mode: "immediate",
      onExecute: "cancel",
    });
    await expect(
      provider.scheduleChange({ subscriptionId: "subscription", choice }),
    ).rejects.toMatchObject({ code: "billing_plan_changes_unavailable" });
    expect(provider.updateCheckout).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("confirms a lost cancel response with a GET without replaying the POST", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST") throw new Error("Response lost");
      return Response.json({ ...subscription, status: "canceled" });
    });
    await expect(
      createCreemProvider(config(), fetcher).revokeSubscription("subscription"),
    ).resolves.toBeUndefined();
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      "POST",
      "GET",
    ]);
  });
  it("keeps revoke work pending when cancellation did not take effect", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(subscription),
    );
    await expect(
      createCreemProvider(config(), fetcher).revokeSubscription("subscription"),
    ).rejects.toMatchObject({ code: "billing_provider_error" });
  });
  it("treats a confirmed missing remote subscription as completed revoke work", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({}, { status: 404 }),
    );
    await expect(
      createCreemProvider(config(), fetcher).revokeSubscription("subscription"),
    ).resolves.toBeUndefined();
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      "POST",
      "GET",
    ]);
  });
  it("rejects a conflicting duplicate transaction instead of discarding earlier dispute evidence", async () => {
    const fetcher = transport({
      transactions: [{ ...transaction, status: "chargeback" }, transaction],
    });
    await expect(
      createCreemProvider(config(), fetcher).fetchSnapshot("user", references),
    ).rejects.toMatchObject({ code: "billing_provider_error" });
  });
  it("invalidates the cached portal identity when a later snapshot fails", async () => {
    let foreign = false;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (foreign)
        return Response.json({ ...subscription, customer: "foreign" });
      return transport()(input, init);
    });
    const provider = createCreemProvider(config(), fetcher);
    await provider.fetchSnapshot("user", references);
    foreign = true;
    await expect(
      provider.fetchSnapshot("user", references),
    ).rejects.toMatchObject({ code: "billing_identity_mismatch" });
    await expect(provider.createPortal("user")).rejects.toMatchObject({
      code: "billing_customer_missing",
    });
  });
  it.each([400, 401, 429, 500])(
    "hides upstream error bodies and never retries POST status %s",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json(
          { message: "fixture-secret customer@example.com" },
          { status },
        ),
      );
      await expect(
        createCreemProvider(config(), fetcher).createCheckout({
          userId: "user",
          choice,
          attemptId: "attempt",
        }),
      ).rejects.toMatchObject({
        statusCode: 502,
        message:
          "Billing provider request failed. Try again or contact support.",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects malformed provider payloads with a safe error", async () => {
    await expect(
      createCreemProvider(
        config(),
        vi.fn<typeof fetch>(async () => Response.json({ id: 5 })),
      ).findCheckout("attempt", "checkout"),
    ).rejects.toMatchObject({ code: "billing_provider_error" });
  });
});
