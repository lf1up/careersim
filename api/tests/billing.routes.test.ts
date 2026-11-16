import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { loadEnv } from "../src/config/env.js";
import { createPgliteClient } from "./helpers/db.js";
import { billingCheckoutAttempts, users } from "../src/db/schema.js";
import { registerAuth, SESSION_COOKIE } from "../src/plugins/auth.js";
import { HttpError, registerErrorHandler } from "../src/plugins/errors.js";
import { billingRoutes } from "../src/modules/billing/billing.route.js";
import { createBillingService } from "../src/modules/billing/billing.service.js";
import { buildPlanCatalog } from "../src/modules/billing/catalog.js";
import { createEntitlementService } from "../src/modules/billing/entitlements.js";
import { createBillingSync } from "../src/modules/billing/sync.js";
import type { BillingSnapshot } from "../src/modules/billing/billing.schema.js";
import { FakeBillingProvider } from "./helpers/fake-billing-provider.js";

function configFixture() {
  return loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
    BILLING_ENABLED: "true",
    POLAR_ACCESS_TOKEN: "test-token",
    POLAR_WEBHOOK_SECRET: "test-secret",
    POLAR_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
    POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-year",
    POLAR_PRO_MONTHLY_PRODUCT_ID: "pro-month",
    POLAR_PRO_YEARLY_PRODUCT_ID: "pro-year",
    PRO_CHANNEL_URL: "https://private.example.com/pros",
  });
}
function paidSnapshot(
  userId: string,
  tier: "plus" | "pro" = "plus",
): Extract<BillingSnapshot, { kind: "subscription" }> {
  const order = {
    orderId: `order-${userId}`,
    productId: `${tier}-month`,
    start: new Date("2026-11-01Z"),
    end: new Date("2026-12-01Z"),
    totalAmount: tier === "plus" ? 900 : 4900,
    refundedAmount: 0,
    dispute: "none" as const,
  };
  return {
    kind: "subscription",
    customerId: `customer-${userId}`,
    subscriptionId: `sub-${userId}`,
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

describe("billing routes and checkout serialization", () => {
  let handle: ReturnType<typeof createPgliteClient>;
  let app: FastifyInstance;
  let provider: FakeBillingProvider;
  let config: ReturnType<typeof configFixture>;
  let service: ReturnType<typeof createBillingService>;
  let userId: string;
  let token: string;
  const now = () => new Date("2026-11-10Z");
  beforeAll(async () => {
    handle = createPgliteClient(new PGlite());
    await migrate(handle.db, { migrationsFolder: "src/db/migrations" });
  });
  afterAll(async () => handle.close());
  beforeEach(async () => {
    provider = new FakeBillingProvider();
    config = configFixture();
    const catalog = buildPlanCatalog(config);
    const entitlements = createEntitlementService({
      db: handle.db,
      catalog,
      now,
    });
    const sync = createBillingSync({ db: handle.db, provider, config, now });
    service = createBillingService({
      db: handle.db,
      config,
      catalog,
      provider,
      ...sync,
      ...entitlements,
      now,
      readUsage: async (_id, limits) => ({
        sessions: {
          used: 1,
          limit: limits.sessionsCreateMax,
          resetAt: "2026-11-10T06:00:00.000Z",
        },
        chatMessages: null,
        customSimulations: null,
        customPersonas: null,
        voice: null,
      }),
    });
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorHandler(app);
    await registerAuth(app, {
      secret: config.JWT_SECRET,
      expiresIn: "1h",
      db: handle.db,
    });
    await app.register(rateLimit, { global: false, hook: "preHandler" });
    await app.register(billingRoutes, { prefix: "/v1", service, catalog });
    const [user] = await handle.db
      .insert(users)
      .values({ id: randomUUID(), email: `${randomUUID()}@example.com` })
      .returning();
    if (!user) throw new Error("Missing fixture user");
    userId = user.id;
    token = await app.issueSessionToken(user);
    await app.ready();
  });
  afterEach(async () => app.close());
  function request(
    method: "GET" | "POST",
    route: string,
    payload?: Record<string, unknown>,
    auth = token,
  ) {
    return app.inject({
      method,
      url: `/v1/billing/${route}`,
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
      ...(payload === undefined ? {} : { payload }),
    });
  }
  it("publishes the safe catalog but requires authentication on all account operations", async () => {
    const catalog = await request("GET", "catalog", undefined, "");
    expect(catalog.statusCode).toBe(200);
    expect(
      catalog.json().plans.find((plan: { tier: string }) => plan.tier === "pro").availability,
    ).toBe("available");
    expect(catalog.body).not.toContain(config.PRO_CHANNEL_URL);
    for (const [method, route] of [
      ["GET", "account"],
      ["GET", "pro"],
      ["POST", "checkout"],
      ["POST", "portal"],
      ["POST", "refresh"],
      ["POST", "change"],
    ] as const) {
      expect(
        (
          await request(
            method,
            route,
            method === "POST" && ["checkout", "change"].includes(route)
              ? { tier: "plus", interval: "month" }
              : undefined,
            "",
          )
        ).statusCode,
      ).toBe(401);
    }
  });
  it.each([
    ["plus", "month"],
    ["plus", "year"],
    ["pro", "month"],
    ["pro", "year"],
  ] as const)(
    "allows the configured %s/%s choice only for the authenticated UUID",
    async (tier, interval) => {
      expect(
        (await request("POST", "checkout", { tier, interval })).statusCode,
      ).toBe(200);
      expect(provider.created).toEqual([
        { userId, choice: { tier, interval }, attemptId: expect.any(String) },
      ]);
      const account = await request("GET", "account");
      expect(account.json().tier).toBe("free");
      expect(account.json().confirmationPending).toBe(true);
      expect(account.body).not.toContain(config.PRO_CHANNEL_URL);
    },
  );
  it.each([
    { tier: "supporter", interval: "month" },
    { tier: "plus", interval: "week" },
    { tier: "plus", interval: "month", price: 1 },
    { tier: "plus", interval: "year", productId: "plus-month" },
    { tier: "plus", interval: "month", userId: "someone-else" },
  ])("rejects unknown or injected choice fields: %j", async (payload) => {
    expect((await request("POST", "checkout", payload)).statusCode).toBe(400);
    expect(provider.created).toHaveLength(0);
  });
  it("supports cookie authentication and stable UUID after an email change", async () => {
    await handle.db
      .update(users)
      .set({ email: `${randomUUID()}@new.example` })
      .where(eq(users.id, userId));
    const response = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      payload: { tier: "plus", interval: "month" },
    });
    expect(response.statusCode).toBe(200);
    expect(provider.created[0]?.userId).toBe(userId);
  });
  it("blocks Pro checkout and changes for both intervals when the channel is missing", async () => {
    config.PRO_CHANNEL_URL = "";
    for (const interval of ["month", "year"])
      for (const route of ["checkout", "change"]) {
        expect(
          (await request("POST", route, { tier: "pro", interval }))
            .statusCode,
        ).toBe(409);
      }
    expect(provider.created).toHaveLength(0);
  });
  it("reuses one checkout when returning to choose a different plan or interval", async () => {
    const choice = { tier: "plus", interval: "month" };
    const results = await Promise.all([
      request("POST", "checkout", choice),
      request("POST", "checkout", choice),
    ]);
    expect(results.some((result) => result.statusCode === 200)).toBe(true);
    const repeated = await request("POST", "checkout", choice);
    expect(repeated.statusCode).toBe(200);
    for (const nextChoice of [
      { tier: "plus", interval: "year" },
      { tier: "pro", interval: "month" },
      choice,
    ]) {
      const switched = await request("POST", "checkout", nextChoice);
      expect(switched.statusCode).toBe(200);
      expect(switched.json().url).toBe(repeated.json().url);
      const [attempt] = await handle.db
        .select()
        .from(billingCheckoutAttempts)
        .where(eq(billingCheckoutAttempts.userId, userId));
      expect(attempt).toMatchObject({ ...nextChoice, status: "pending" });
      expect(provider.selectedChoices.get(attempt?.checkoutId ?? "")).toEqual(
        nextChoice,
      );
    }
    expect(provider.created).toHaveLength(1);
  });
  it.each([
    [new Error("Provider timeout"), 503],
    [
      new HttpError(409, "Payment is processing", "billing_checkout_conflict"),
      409,
    ],
  ])(
    "retains the existing checkout when an update fails with %s",
    async (error, status) => {
      const choice = { tier: "plus", interval: "month" };
      const first = await request("POST", "checkout", choice);
      vi.spyOn(provider, "updateCheckout").mockRejectedValueOnce(error);
      const failed = await request("POST", "checkout", {
        tier: "pro",
        interval: "year",
      });
      expect(failed.statusCode).toBe(status);
      const [attempt] = await handle.db
        .select()
        .from(billingCheckoutAttempts)
        .where(eq(billingCheckoutAttempts.userId, userId));
      expect(attempt).toMatchObject({ ...choice, status: "pending" });
      const retried = await request("POST", "checkout", choice);
      expect(retried.statusCode).toBe(200);
      expect(retried.json().url).toBe(first.json().url);
      expect(provider.created).toHaveLength(1);
    },
  );
  it("reapplies the requested plan after a provider update response is lost", async () => {
    const choice = { tier: "plus", interval: "month" };
    const first = await request("POST", "checkout", choice);
    const update = provider.updateCheckout.bind(provider);
    vi.spyOn(provider, "updateCheckout").mockImplementationOnce(
      async (input) => {
        await update(input);
        throw new Error("Response lost after provider update");
      },
    );
    expect(
      (await request("POST", "checkout", { tier: "pro", interval: "year" }))
        .statusCode,
    ).toBe(503);
    const retried = await request("POST", "checkout", choice);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().url).toBe(first.json().url);
    const [attempt] = await handle.db
      .select()
      .from(billingCheckoutAttempts)
      .where(eq(billingCheckoutAttempts.userId, userId));
    expect(provider.selectedChoices.get(attempt?.checkoutId ?? "")).toEqual(
      choice,
    );
    expect(provider.created).toHaveLength(1);
  });
  it("keeps a returning subscriber's unpaid checkout open through historical-payment refreshes", async () => {
    const historical = paidSnapshot(userId);
    const oldOrder = {
      orderId: "historical-order",
      checkoutId: "historical-checkout",
      productId: "plus-month",
      start: new Date("2026-09-01Z"),
      end: new Date("2026-10-01Z"),
      totalAmount: 900,
      refundedAmount: 0,
      dispute: "none" as const,
    };
    provider.snapshots.set(userId, {
      ...historical,
      status: "canceled",
      revoked: true,
      paidPeriod: oldOrder,
      orders: [oldOrder],
    });
    const choice = { tier: "plus", interval: "month" };
    const first = await request("POST", "checkout", choice);
    expect(first.statusCode).toBe(200);

    const refreshed = await request("POST", "refresh");
    expect(refreshed.json()).toMatchObject({
      tier: "free",
      pendingCheckout: true,
      confirmationPending: true,
    });
    const repeated = await request("POST", "checkout", choice);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().url).toBe(first.json().url);
    const switched = await request("POST", "checkout", {
      tier: "plus",
      interval: "year",
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().url).toBe(first.json().url);
    expect(provider.created).toHaveLength(1);

    const [attempt] = await handle.db
      .select()
      .from(billingCheckoutAttempts)
      .where(eq(billingCheckoutAttempts.userId, userId));
    const newOrder = {
      ...oldOrder,
      orderId: "new-order",
      checkoutId: attempt?.checkoutId,
      start: new Date("2026-11-10Z"),
      end: new Date("2026-12-10Z"),
    };
    provider.snapshots.set(userId, {
      ...paidSnapshot(userId),
      subscriptionId: "new-subscription",
      paidPeriod: newOrder,
      orders: [newOrder],
    });
    const activated = await request("POST", "refresh");
    expect(activated.json()).toMatchObject({
      tier: "plus",
      pendingCheckout: false,
      confirmationPending: false,
    });
  });
  it("serializes competing monthly/yearly tabs into one intended subscription", async () => {
    const results = await Promise.all([
      request("POST", "checkout", { tier: "plus", interval: "month" }),
      request("POST", "checkout", { tier: "plus", interval: "year" }),
    ]);
    expect(results.some((result) => result.statusCode === 200)).toBe(true);
    expect(
      results.every((result) => [200, 409].includes(result.statusCode)),
    ).toBe(true);
    expect(
      new Set(
        results
          .filter((result) => result.statusCode === 200)
          .map((result) => result.json().url),
      ).size,
    ).toBe(1);
    expect(provider.created).toHaveLength(1);
  });
  it("rate-limits billing operations independently of each other", async () => {
    for (let i = 0; i < 6; i++)
      expect(
        (await request("POST", "checkout", { tier: "plus", interval: "month" }))
          .statusCode,
      ).toBe(200);
    expect(
      (await request("POST", "checkout", { tier: "plus", interval: "month" }))
        .statusCode,
    ).toBe(429);
    expect((await request("POST", "refresh")).statusCode).toBe(200);
  });
  it("propagates database failures rather than turning them into successful refreshes", async () => {
    const catalog = buildPlanCatalog(config);
    const brokenSync = createBillingService({
      db: handle.db,
      config,
      catalog,
      provider,
      syncCustomer: async () => {
        throw new Error("database write failed");
      },
      ...createEntitlementService({ db: handle.db, catalog, now }),
      now,
    });
    await expect(brokenSync.refresh(userId)).rejects.toThrow(
      "database write failed",
    );
  });

  it("recovers a created checkout after an ambiguous timeout without repeating create", async () => {
    provider.timeoutAfterCreate = true;
    const choice = { tier: "plus", interval: "month" };
    expect((await request("POST", "checkout", choice)).statusCode).toBe(503);
    expect((await request("POST", "checkout", choice)).statusCode).toBe(200);
    expect(provider.created).toHaveLength(1);
  });
  it("retains an unresolved committed attempt instead of blindly retrying create", async () => {
    await handle.db.insert(billingCheckoutAttempts).values({
      attemptId: randomUUID(),
      userId,
      tier: "plus",
      interval: "month",
      status: "creating",
    });
    expect(
      (await request("POST", "checkout", { tier: "plus", interval: "month" }))
        .statusCode,
    ).toBe(409);
    expect(provider.created).toHaveLength(0);
  });
  it("expires a positively identified checkout before permitting a different choice", async () => {
    await handle.db.insert(billingCheckoutAttempts).values({
      attemptId: randomUUID(),
      userId,
      tier: "plus",
      interval: "month",
      status: "pending",
      checkoutId: `expired-${userId}`,
      url: "https://checkout.polar.sh/expired",
      expiresAt: new Date("2026-11-09Z"),
    });
    expect(
      (await request("POST", "checkout", { tier: "plus", interval: "year" }))
        .statusCode,
    ).toBe(200);
    expect(provider.created).toHaveLength(1);
  });
  it("sends existing subscribers to management and preserves portal access when purchases close", async () => {
    provider.snapshots.set(userId, paidSnapshot(userId));
    const response = await request("POST", "checkout", {
      tier: "plus",
      interval: "year",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().url).toContain(`/portal/${userId}`);
    expect(provider.created).toHaveLength(0);
    config.BILLING_ENABLED = false;
    expect((await request("POST", "portal")).statusCode).toBe(200);
    expect((await request("GET", "account")).json().tier).toBe("plus");
    expect(
      (await request("POST", "checkout", { tier: "plus", interval: "month" }))
        .statusCode,
    ).toBe(409);
  });
  it("keeps account and portal scoped to the authenticated caller and rejects identity injection", async () => {
    provider.snapshots.set(userId, paidSnapshot(userId));
    await service.refresh(userId);
    const [other] = await handle.db
      .insert(users)
      .values({ id: randomUUID(), email: `${randomUUID()}@other.example` })
      .returning();
    if (!other) throw new Error("Missing other user");
    const otherToken = await app.issueSessionToken(other);
    expect(
      (
        await request("GET", `account?userId=${userId}`, undefined, otherToken)
      ).json().tier,
    ).toBe("free");
    expect(
      (await request("POST", "portal", undefined, otherToken)).statusCode,
    ).toBe(409);
    expect(
      (await request("POST", "portal", { userId }, otherToken)).statusCode,
    ).toBe(400);
  });
  it("returns last bounded entitlement and pending confirmation on provider outage", async () => {
    provider.snapshots.set(userId, paidSnapshot(userId));
    expect((await request("POST", "refresh")).json().tier).toBe("plus");
    provider.failFetch = true;
    const account = (await request("POST", "refresh")).json();
    expect(account.tier).toBe("plus");
    expect(account.confirmationPending).toBe(true);
    expect(account.usage.sessions.used).toBe(1);
    expect(
      (await request("POST", "checkout", { tier: "plus", interval: "year" }))
        .statusCode,
    ).toBe(503);
    expect(provider.created).toHaveLength(0);
  });
  it("keeps next-period switches disabled with a contact fallback", async () => {
    const response = await request("POST", "change", {
      tier: "plus",
      interval: "year",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().contactUrl).toBe("/contact");
  });
  it("reveals the private channel only to a verified current Pro", async () => {
    expect((await request("GET", "pro")).statusCode).toBe(403);
    provider.snapshots.set(userId, paidSnapshot(userId));
    await service.refresh(userId);
    expect((await request("GET", "pro")).statusCode).toBe(403);
    const pro = paidSnapshot(userId, "pro");
    provider.snapshots.set(userId, pro);
    await service.refresh(userId);
    const response = await request("GET", "pro");
    expect(response.statusCode).toBe(200);
    expect(response.json().channelUrl).toBe(config.PRO_CHANNEL_URL);
    expect((await request("GET", "account")).body).not.toContain(
      config.PRO_CHANNEL_URL,
    );
  });
});
