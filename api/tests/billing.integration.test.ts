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

const independentLimitsConfig = () =>
  loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
    BILLING_ENABLED: "true",
    CREEM_ENABLED: "false",
    POLAR_ENABLED: "true",
    BILLING_DEFAULT_PROVIDER: "polar",
    POLAR_ACCESS_TOKEN: "fixture-token",
    POLAR_WEBHOOK_SECRET: "fixture-secret",
    POLAR_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
    POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-year",
    POLAR_PRO_MONTHLY_PRODUCT_ID: "pro-month",
    POLAR_PRO_YEARLY_PRODUCT_ID: "pro-year",
    PRO_CHANNEL_URL: "https://private.example/pros",
    SESSIONS_CREATE_MAX: "1",
    CHAT_MESSAGES_MAX: "1",
    CUSTOM_SIMULATIONS_MAX: "1",
    CUSTOM_PERSONAS_MAX: "1",
    VOICE_DAILY_MINUTES_PER_USER: "1",
    PLUS_SESSIONS_CREATE_MAX: "2",
    PLUS_CHAT_MESSAGES_MAX: "3",
    PLUS_CUSTOM_SIMULATIONS_MAX: "2",
    PLUS_CUSTOM_PERSONAS_MAX: "2",
    PLUS_VOICE_DAILY_MINUTES_PER_USER: "2",
    PRO_SESSIONS_CREATE_MAX: "3",
    PRO_CHAT_MESSAGES_MAX: "5",
    PRO_CUSTOM_SIMULATIONS_MAX: "3",
    PRO_CUSTOM_PERSONAS_MAX: "3",
    PRO_VOICE_DAILY_MINUTES_PER_USER: "3",
  });
function tierSnapshot(
  tier: "plus" | "pro",
  start: Date,
  end: Date,
): BillingSnapshot {
  const order: PaidOrder = {
    orderId: `${tier}-order`,
    productId: `${tier}-month`,
    start,
    end,
    totalAmount: tier === "plus" ? 900 : 4900,
    refundedAmount: 0,
    dispute: "none",
  };
  return {
    kind: "subscription",
    customerId: "tier-customer",
    subscriptionId: "tier-subscription",
    productId: order.productId,
    choice: { tier, interval: "month" },
    status: "active",
    paidPeriod: order,
    orders: [order],
    cancelAtPeriodEnd: false,
    failedRenewal: false,
    revoked: false,
    pendingChange: null,
  };
}

describe("subscription access through the full API", () => {
  let harness: TestHarness | undefined;
  afterEach(async () => {
    await harness?.close();
  });

  it("enforces independent Pro caps and keeps window usage after a verified Plus downgrade", async () => {
    let clock = new Date("2026-11-10T12:00:00Z");
    const provider = new FakeBillingProvider();
    harness = await buildTestApp({
      billing: {
        config: independentLimitsConfig(),
        providers: { polar: provider },
        now: () => clock,
      },
      rateLimitEnabled: true,
      rateLimitGlobalMax: 1000,
      quotaStore: createMemoryWindowQuota({ now: () => clock }),
    });
    const { app } = harness;
    const { userId, authHeader: headers } = await registerAndAuth(app);
    provider.snapshots.set(
      userId,
      tierSnapshot(
        "pro",
        new Date("2026-10-10T12:00:15Z"),
        new Date("2026-11-10T12:00:15Z"),
      ),
    );
    const pro = await app.inject({
      method: "POST",
      url: "/v1/billing/refresh",
      headers,
    });
    expect(pro.statusCode, pro.body).toBe(200);
    expect(pro.json()).toMatchObject({
      tier: "pro",
      limits: {
        sessionsCreateMax: 3,
        chatMessagesMax: 5,
        customSimulationsMax: 3,
        customPersonasMax: 3,
        voiceDailyMinutes: 3,
      },
    });
    const create = () =>
      app.inject({
        method: "POST",
        url: "/v1/sessions",
        headers,
        payload: { simulation_slug: "behavioral-interview-brenda" },
      });
    const first = await create();
    expect(first.statusCode, first.body).toBe(201);
    expect((await create()).statusCode).toBe(201);
    expect((await create()).statusCode).toBe(201);
    expect((await create()).json()).toMatchObject({
      error: "RATE_LIMITED",
      tier: "pro",
      used: 3,
      max: 3,
    });
    const send = (content: string | string[]) =>
      app.inject({
        method: "POST",
        url: `/v1/sessions/${first.json().id}/messages`,
        headers,
        payload: { content },
      });
    expect(
      (await send(["one", "two", "three", "four", "five"])).statusCode,
    ).toBe(200);
    expect((await send("six")).json()).toMatchObject({
      error: "RATE_LIMITED",
      tier: "pro",
      used: 5,
      max: 5,
    });
    const before = (
      await app.inject({ method: "GET", url: "/v1/billing/account", headers })
    ).json();

    clock = new Date("2026-11-10T12:00:15Z");
    provider.snapshots.set(
      userId,
      tierSnapshot("plus", clock, new Date("2026-12-10T12:00:15Z")),
    );
    const downgraded = await app.inject({
      method: "POST",
      url: "/v1/billing/refresh",
      headers,
    });
    expect(downgraded.statusCode, downgraded.body).toBe(200);
    expect(downgraded.json()).toMatchObject({
      tier: "plus",
      usage: {
        sessions: { used: 3, limit: 2, resetAt: before.usage.sessions.resetAt },
        chatMessages: {
          used: 5,
          limit: 3,
          resetAt: before.usage.chatMessages.resetAt,
        },
      },
    });
    expect((await create()).json()).toMatchObject({
      error: "RATE_LIMITED",
      tier: "plus",
      used: 3,
      max: 2,
    });
    expect((await send("still over quota")).json()).toMatchObject({
      error: "RATE_LIMITED",
      tier: "plus",
      used: 5,
      max: 3,
    });
  });
  it("keeps daily voice seconds when verified Pro access changes to the lower Plus cap", async () => {
    let clock = new Date("2026-11-10T12:00:00Z");
    const provider = new FakeBillingProvider();
    const internal = { "x-internal-key": "test-internal-key" };
    harness = await buildTestApp({
      billing: {
        config: independentLimitsConfig(),
        providers: { polar: provider },
        now: () => clock,
      },
      voice: { enabled: true, now: () => clock, terminateRoom: async () => {} },
    });
    const { app } = harness;
    const { userId, authHeader: headers } = await registerAndAuth(app);
    provider.snapshots.set(
      userId,
      tierSnapshot(
        "pro",
        new Date("2026-10-10T12:01:00Z"),
        new Date("2026-11-10T12:01:00Z"),
      ),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/billing/refresh",
          headers,
        })
      ).statusCode,
    ).toBe(200);
    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers,
      payload: { simulation_slug: "behavioral-interview-brenda" },
    });
    expect(session.statusCode, session.body).toBe(201);
    const sessionId = session.json().id;
    const budget = () =>
      app.inject({
        method: "GET",
        url: `/v1/internal/sessions/${sessionId}/voice-budget`,
        headers: internal,
      });
    expect((await budget()).json()).toMatchObject({
      cap_seconds: 180,
      remaining_seconds: 180,
    });
    const call = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/voice/start`,
      headers,
    });
    expect(call.statusCode, call.body).toBe(200);
    const checkpoint = (sequence: number) =>
      app.inject({
        method: "POST",
        url: `/v1/internal/voice/calls/${call.json().call_id}/checkpoint`,
        headers: internal,
        payload: { sequence, cumulative_seconds: sequence * 15, ended: false },
      });
    for (let sequence = 1; sequence <= 3; sequence++) {
      clock = new Date(clock.getTime() + 15000);
      expect((await checkpoint(sequence)).statusCode).toBe(200);
    }
    expect((await budget()).json()).toMatchObject({
      cap_seconds: 180,
      remaining_seconds: 135,
    });
    clock = new Date("2026-11-10T12:01:00Z");
    provider.snapshots.set(
      userId,
      tierSnapshot("plus", clock, new Date("2026-12-10T12:01:00Z")),
    );
    const downgraded = await app.inject({
      method: "POST",
      url: "/v1/billing/refresh",
      headers,
    });
    expect(downgraded.json()).toMatchObject({
      tier: "plus",
      usage: { voice: { used: 0.75, limit: 2 } },
    });
    expect((await budget()).json()).toMatchObject({
      cap_seconds: 120,
      remaining_seconds: 75,
    });
    for (let sequence = 4; sequence <= 8; sequence++) {
      const result = await checkpoint(sequence);
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().continue_call).toBe(sequence < 8);
      if (sequence < 8) clock = new Date(clock.getTime() + 15000);
    }
    expect((await budget()).json()).toMatchObject({
      cap_seconds: 120,
      remaining_seconds: 0,
    });
    const account = await app.inject({
      method: "GET",
      url: "/v1/billing/account",
      headers,
    });
    expect(account.json()).toMatchObject({
      usage: { voice: { used: 2, limit: 2 } },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/sessions/${sessionId}/voice/start`,
          headers,
        })
      ).statusCode,
    ).toBe(429);
  });
  it("activates verified annual access on the same counters and preserves access until cancellation expiry", async () => {
    const config = loadEnv({
      DATABASE_URL: "postgres://test",
      AGENT_API_URL: "http://test",
      JWT_SECRET: "test-secret-test-secret",
      ALTCHA_HMAC_KEY: "test-secret-test-secret",
      BILLING_ENABLED: "true",
      CREEM_ENABLED: "false",
      POLAR_ENABLED: "true",
      BILLING_DEFAULT_PROVIDER: "polar",
      POLAR_ACCESS_TOKEN: "fixture-token",
      POLAR_WEBHOOK_SECRET: "fixture-secret",
      POLAR_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
      POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-year",
      POLAR_PRO_MONTHLY_PRODUCT_ID: "pro-month",
      POLAR_PRO_YEARLY_PRODUCT_ID: "pro-year",
      PRO_CHANNEL_URL: "https://private.example/pros",
    });
    let clock = new Date("2026-11-10T12:00:00Z");
    const provider = new FakeBillingProvider();
    harness = await buildTestApp({
      billing: { config, providers: { polar: provider }, now: () => clock },
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
        voiceDailyMinutes: 360,
      },
    });
    expect((await create()).statusCode).toBe(201);
    expect((await account()).json().usage.sessions.used).toBe(3);
    const pro = await app.inject({
      method: "POST",
      url: "/v1/billing/change",
      headers: auth.authHeader,
      payload: { tier: "pro", interval: "month" },
    });
    expect(pro.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/billing/pro",
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
  it("keeps verified billing and portal access available when quota reads fail", async () => {
    const config = loadEnv({
      DATABASE_URL: "postgres://test",
      AGENT_API_URL: "http://test",
      JWT_SECRET: "test-secret-test-secret",
      ALTCHA_HMAC_KEY: "test-secret-test-secret",
      BILLING_ENABLED: "true",
      CREEM_ENABLED: "false",
      POLAR_ENABLED: "true",
      BILLING_DEFAULT_PROVIDER: "polar",
      POLAR_ACCESS_TOKEN: "fixture-token",
      POLAR_WEBHOOK_SECRET: "fixture-secret",
      POLAR_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
      POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-year",
    });
    const provider = new FakeBillingProvider();
    const store = createMemoryWindowQuota();
    harness = await buildTestApp({
      billing: { config, providers: { polar: provider } },
      quotaStore: {
        consume: store.consume,
        async read() {
          throw new Error("Quota store unavailable");
        },
      },
    });
    const { app } = harness;
    const auth = await registerAndAuth(app);
    const now = Date.now();
    const order: PaidOrder = {
      orderId: "paid-outage-order",
      productId: "plus-month",
      start: new Date(now - 1000),
      end: new Date(now + 86400000),
      totalAmount: 900,
      refundedAmount: 0,
      dispute: "none",
    };
    provider.snapshots.set(auth.userId, {
      kind: "subscription",
      customerId: "outage-customer",
      subscriptionId: "outage-subscription",
      productId: "plus-month",
      choice: { tier: "plus", interval: "month" },
      status: "active",
      paidPeriod: order,
      orders: [order],
      cancelAtPeriodEnd: false,
      failedRenewal: false,
      revoked: false,
      pendingChange: null,
    });
    const refreshed = await app.inject({
      method: "POST",
      url: "/v1/billing/refresh",
      headers: auth.authHeader,
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json()).toMatchObject({
      tier: "plus",
      usage: { sessions: null, chatMessages: null },
    });
    const account = await app.inject({
      method: "GET",
      url: "/v1/billing/account",
      headers: auth.authHeader,
    });
    expect(account.statusCode, account.body).toBe(200);
    expect(account.json().tier).toBe("plus");
    const portal = await app.inject({
      method: "POST",
      url: "/v1/billing/portal",
      headers: auth.authHeader,
    });
    expect(portal.statusCode, portal.body).toBe(200);
    expect(portal.json().url).toMatch(/^https:/);
  });
});
