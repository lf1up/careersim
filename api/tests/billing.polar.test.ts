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
      products: ["plus-year"],
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
});
