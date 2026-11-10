import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import type {
  BillingSnapshot,
  PaidOrder,
} from "../src/modules/billing/billing.schema.js";
import { createMemoryWindowQuota } from "../src/modules/quotas/window-quota.js";
import { FakeBillingProvider } from "./helpers/fake-billing-provider.js";
import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from "./helpers/build-test-app.js";

describe("subscription access through the full API", () => {
  let harness: TestHarness | undefined;
  afterEach(async () => {
    await harness?.close();
  });

  it("activates verified annual access on the same counters and preserves access until cancellation expiry", async () => {
    const config = loadEnv({
      DATABASE_URL: "postgres://test",
      AGENT_API_URL: "http://test",
      JWT_SECRET: "test-secret-test-secret",
      ALTCHA_HMAC_KEY: "test-secret-test-secret",
      BILLING_ENABLED: "true",
      POLAR_ACCESS_TOKEN: "fixture-token",
      POLAR_WEBHOOK_SECRET: "fixture-secret",
      POLAR_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
      POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-year",
      POLAR_SUPPORTER_MONTHLY_PRODUCT_ID: "supporter-month",
      POLAR_SUPPORTER_YEARLY_PRODUCT_ID: "supporter-year",
    });
    let clock = new Date("2026-11-10T12:00:00Z");
    const provider = new FakeBillingProvider();
    harness = await buildTestApp({
      billing: { config, provider, now: () => clock },
      rateLimitEnabled: true,
      rateLimitGlobalMax: 1000,
      quotaStore: createMemoryWindowQuota({ now: () => clock }),
    });
    const { app } = harness;
    const auth = await registerAndAuth(app);
    const create = () =>
      app.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: auth.authHeader,
        payload: { simulation_slug: "behavioral-interview-brenda" },
      });
    expect((await create()).statusCode).toBe(201);
    expect((await create()).statusCode).toBe(201);
    expect((await create()).statusCode).toBe(429);
    const checkout = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: auth.authHeader,
      payload: { tier: "plus", interval: "year" },
    });
    expect(checkout.statusCode, checkout.body).toBe(200);
    const account = () =>
      app.inject({
        method: "GET",
        url: "/v1/billing/account",
        headers: auth.authHeader,
      });
    expect((await account()).json().tier).toBe("free");
    const at = clock.getTime();
    const order: PaidOrder = {
      orderId: "annual-order",
      productId: "plus-year",
      start: new Date(at - 86400000),
      end: new Date(at + 365 * 86400000),
      totalAmount: 9000,
      refundedAmount: 0,
      dispute: "none",
    };
    const snapshot: Extract<BillingSnapshot, { kind: "subscription" }> = {
      kind: "subscription",
      customerId: "customer-annual",
      subscriptionId: "subscription-annual",
      productId: "plus-year",
      choice: { tier: "plus", interval: "year" },
      status: "active",
      paidPeriod: order,
      orders: [order],
      cancelAtPeriodEnd: true,
      failedRenewal: false,
      revoked: false,
      pendingChange: null,
    };
    provider.snapshots.set(auth.userId, snapshot);
    const refresh = () =>
      app.inject({
        method: "POST",
        url: "/v1/billing/refresh",
        headers: auth.authHeader,
      });
    const activated = await refresh();
    expect(activated.statusCode, activated.body).toBe(200);
    expect(activated.json()).toMatchObject({
      tier: "plus",
      interval: "year",
      cancelAtPeriodEnd: true,
      usage: { sessions: { used: 2, limit: 100 } },
      limits: {
        chatMessagesMax: 3000,
        customSimulationsMax: 250,
        customPersonasMax: 250,
        voiceDailyMinutes: 720,
      },
    });
    expect((await create()).statusCode).toBe(201);
    expect((await account()).json().usage.sessions.used).toBe(3);
    const supporter = await app.inject({
      method: "POST",
      url: "/v1/billing/change",
      headers: auth.authHeader,
      payload: { tier: "supporter", interval: "month" },
    });
    expect(supporter.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/billing/supporter",
          headers: auth.authHeader,
        })
      ).statusCode,
    ).toBe(403);
    const other = await registerAndAuth(app, "other@example.com");
    const isolated = await app.inject({
      method: "GET",
      url: "/v1/billing/account",
      headers: other.authHeader,
    });
    expect(isolated.json()).toMatchObject({ tier: "free", paidThrough: null });
    clock = new Date(order.end.getTime() + 1000);
    provider.snapshots.set(auth.userId, { ...snapshot, status: "canceled" });
    const expired = await refresh();
    expect(expired.statusCode, expired.body).toBe(200);
    expect(expired.json().tier).toBe("free");
    expect(expired.json().usage.sessions.used).toBe(0);
    expect((await create()).statusCode).toBe(201);
    const history = await app.inject({
      method: "GET",
      url: "/v1/sessions",
      headers: auth.authHeader,
    });
    expect(history.statusCode).toBe(200);
  });
  it('keeps verified billing and portal access available when quota reads fail', async () => {
    const config = loadEnv({ DATABASE_URL: 'postgres://test', AGENT_API_URL: 'http://test',
      JWT_SECRET: 'test-secret-test-secret', ALTCHA_HMAC_KEY: 'test-secret-test-secret',
      BILLING_ENABLED: 'true', POLAR_ACCESS_TOKEN: 'fixture-token', POLAR_WEBHOOK_SECRET: 'fixture-secret',
      POLAR_PLUS_MONTHLY_PRODUCT_ID: 'plus-month', POLAR_PLUS_YEARLY_PRODUCT_ID: 'plus-year' });
    const provider = new FakeBillingProvider();
    const store = createMemoryWindowQuota();
    harness = await buildTestApp({ billing: { config, provider }, quotaStore: {
      consume: store.consume, async read() { throw new Error('Quota store unavailable'); },
    } });
    const { app } = harness;
    const auth = await registerAndAuth(app);
    const now = Date.now();
    const order: PaidOrder = { orderId: 'paid-outage-order', productId: 'plus-month',
      start: new Date(now - 1000), end: new Date(now + 86400000),
      totalAmount: 900, refundedAmount: 0, dispute: 'none' };
    provider.snapshots.set(auth.userId, { kind: 'subscription', customerId: 'outage-customer',
      subscriptionId: 'outage-subscription', productId: 'plus-month', choice: { tier: 'plus', interval: 'month' },
      status: 'active', paidPeriod: order, orders: [order], cancelAtPeriodEnd: false,
      failedRenewal: false, revoked: false, pendingChange: null });
    const refreshed = await app.inject({ method: 'POST', url: '/v1/billing/refresh', headers: auth.authHeader });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json()).toMatchObject({ tier: 'plus', usage: { sessions: null, chatMessages: null } });
    const account = await app.inject({ method: 'GET', url: '/v1/billing/account', headers: auth.authHeader });
    expect(account.statusCode, account.body).toBe(200);
    expect(account.json().tier).toBe('plus');
    const portal = await app.inject({ method: 'POST', url: '/v1/billing/portal', headers: auth.authHeader });
    expect(portal.statusCode, portal.body).toBe(200);
    expect(portal.json().url).toMatch(/^https:/);
  });

});
