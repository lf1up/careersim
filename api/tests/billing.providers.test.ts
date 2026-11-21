import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, expect, it } from "vitest";
import { createPgliteClient } from "./helpers/db.js";
import { loadEnv } from "../src/config/env.js";
import {
  billingCustomers,
  billingCheckoutAttempts,
  billingProviderCustomers,
  billingWebhookInbox,
  users,
} from "../src/db/schema.js";
import { createBillingSync } from "../src/modules/billing/sync.js";
import { FakeBillingProvider } from "./helpers/fake-billing-provider.js";
import { createBillingService } from "../src/modules/billing/billing.service.js";
import { buildPlanCatalog } from "../src/modules/billing/catalog.js";
import { createEntitlementService } from "../src/modules/billing/entitlements.js";
import type { BillingProvider } from "../src/modules/billing/provider.js";
import type { BillingSnapshot } from "../src/modules/billing/billing.schema.js";
import { createBillingReconciler } from "../src/modules/billing/reconcile.js";
import { eq } from "drizzle-orm";
import { HttpError } from "../src/plugins/errors.js";

const handles: ReturnType<typeof createPgliteClient>[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
});
async function setup() {
  const handle = createPgliteClient(new PGlite());
  handles.push(handle);
  await migrate(handle.db, { migrationsFolder: "src/db/migrations" });
  const userId = randomUUID();
  await handle.db
    .insert(users)
    .values({ id: userId, email: `${userId}@test.local` });
  await handle.db.insert(billingCustomers).values({ userId });
  return { ...handle, userId };
}
it("scopes identical remote customer and event IDs by provider", async () => {
  const { db, userId } = await setup();
  await db.insert(billingProviderCustomers).values([
    { userId, provider: "polar", customerId: "same" },
    { userId, provider: "creem", customerId: "same" },
  ]);
  await db.insert(billingWebhookInbox).values([
    {
      provider: "polar",
      eventId: "same",
      eventType: "subscription.paid",
      userId,
    },
    {
      provider: "creem",
      eventId: "same",
      eventType: "subscription.paid",
      userId,
    },
  ]);
  expect(await db.select().from(billingProviderCustomers)).toHaveLength(2);
  expect(await db.select().from(billingWebhookInbox)).toHaveLength(2);
});
it("makes no calls to a disabled provider even when an adapter and credentials exist", async () => {
  const { db, userId } = await setup();
  const polar = new FakeBillingProvider();
  polar.failFetch = true;
  const creem = new FakeBillingProvider();
  const config = loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
    POLAR_ACCESS_TOKEN: "leftover",
  });
  const sync = createBillingSync({ db, providers: { polar, creem }, config });
  await expect(
    sync.syncCustomer({ userId, reason: "refresh" }),
  ).resolves.toBeUndefined();
});

function configFixture(routes = "") {
  return loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
    BILLING_ENABLED: "true",
    POLAR_ENABLED: "true",
    BILLING_COUNTRY_PROVIDERS: routes,
    CREEM_API_KEY: "fixture",
    CREEM_WEBHOOK_SECRET: "fixture",
    CREEM_PLUS_MONTHLY_PRODUCT_ID: "prod_pm",
    CREEM_PLUS_YEARLY_PRODUCT_ID: "prod_py",
    POLAR_ACCESS_TOKEN: "fixture",
    POLAR_WEBHOOK_SECRET: "fixture",
    POLAR_PLUS_MONTHLY_PRODUCT_ID: "polar_pm",
    POLAR_PLUS_YEARLY_PRODUCT_ID: "polar_py",
  });
}
function service(
  db: ReturnType<typeof createPgliteClient>["db"],
  providers: { creem: BillingProvider; polar?: BillingProvider },
  config = configFixture(),
) {
  const catalog = buildPlanCatalog(config);
  return createBillingService({
    productName: "CareerSIM",
    db,
    providers,
    config,
    catalog,
    ...createBillingSync({ db, providers, config }),
    ...createEntitlementService({ db, catalog }),
  });
}
it("serializes concurrent country routes into one payable checkout across providers", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  const polar = new FakeBillingProvider();
  const billing = service(db, { creem, polar }, configFixture("IN=polar"));
  await Promise.allSettled([
    billing.startCheckout({
      userId,
      choice: { tier: "plus", interval: "month", billingCountry: "GE" },
    }),
    billing.startCheckout({
      userId,
      choice: { tier: "plus", interval: "month", billingCountry: "IN" },
    }),
  ]);
  expect(creem.created.length + polar.created.length).toBe(1);
});
it("inspects unknown-expiry checkouts before allowing a different plan after confirmed closure", async () => {
  const { db, userId } = await setup();
  const fake = new FakeBillingProvider();
  let closed = false;
  const creem: BillingProvider = {
    fetchSnapshot: fake.fetchSnapshot.bind(fake),
    createCheckout: async (input) => ({
      ...(await fake.createCheckout(input)),
      expiresAt: null,
    }),
    findCheckout: async (attempt) => {
      const found = await fake.findCheckout(attempt);
      return found
        ? { ...found, expiresAt: null, state: closed ? "closed" : "open" }
        : null;
    },
    createPortal: fake.createPortal.bind(fake),
    scheduleChange: fake.scheduleChange.bind(fake),
    revokeSubscription: fake.revokeSubscription.bind(fake),
  };
  const enabled = service(db, { creem }, configFixture());
  await enabled.startCheckout({
    userId,
    choice: { tier: "plus", interval: "month" },
  });
  await expect(
    enabled.startCheckout({
      userId,
      choice: { tier: "plus", interval: "year" },
    }),
  ).rejects.toMatchObject({ code: "billing_checkout_conflict" });
  expect(fake.created).toHaveLength(1);
  closed = true;
  await expect(
    enabled.startCheckout({
      userId,
      choice: { tier: "plus", interval: "year" },
    }),
  ).resolves.toHaveProperty("url");
  expect(fake.created).toHaveLength(2);
});

it("does not grant an arbitrary paid tier when conflicting providers are discovered before any verified aggregate", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  const polar = new FakeBillingProvider();
  function paid(productId: string): BillingSnapshot {
    const order = {
      orderId: "same-order",
      productId,
      start: new Date(Date.now() - 60_000),
      end: new Date(Date.now() + 3_600_000),
      totalAmount: 900,
      refundedAmount: 0,
      dispute: "none" as const,
    };
    return {
      kind: "subscription",
      customerId: "same-customer",
      subscriptionId: "same-subscription",
      productId,
      choice: { tier: "plus", interval: "month" },
      status: "active",
      orders: [order],
      paidPeriod: order,
      cancelAtPeriodEnd: false,
      failedRenewal: false,
      revoked: false,
      pendingChange: null,
    };
  }
  creem.snapshots.set(userId, paid("prod_pm"));
  polar.snapshots.set(userId, paid("polar_pm"));
  const config = configFixture();
  const providers = { creem, polar };
  await createBillingSync({ db, providers, config }).syncCustomer({
    userId,
    provider: "polar",
    reason: "refresh",
  });
  const account = await service(db, providers, config).getAccount(userId);
  expect(account).toMatchObject({
    billingConflict: true,
    tier: "free",
    proAccess: false,
  });
  await expect(
    service(db, providers, config).startCheckout({
      userId,
      choice: { tier: "plus", interval: "month" },
    }),
  ).rejects.toMatchObject({ code: "billing_duplicate_subscriptions" });
  expect(creem.created.length + polar.created.length).toBe(0);
});

it("reconciles a due provider even when the account retry deadline is later", async () => {
  const { db, userId } = await setup();
  await db
    .update(billingCustomers)
    .set({ nextSyncAt: new Date(Date.now() + 3_600_000) })
    .where(eq(billingCustomers.userId, userId));
  await db
    .insert(billingProviderCustomers)
    .values({ userId, provider: "creem", snapshot: { kind: "none" } });
  let refreshed = 0;
  const worker = createBillingReconciler({
    db,
    enabledProviders: ["creem"],
    syncCustomer: async () => {
      refreshed++;
    },
  });
  expect(await worker.reconcileBilling({ limit: 10 })).toEqual({
    processed: 1,
    failed: 0,
  });
  expect(refreshed).toBe(1);
});

it("backs off rolled-back provider syncs so healthy accounts get the next batch", async () => {
  const { db, userId } = await setup();
  const healthyUserId = randomUUID();
  await db.insert(users).values({
    id: healthyUserId,
    email: `${healthyUserId}@test.local`,
  });
  let clock = new Date("2026-11-20T12:00:00Z");
  const later = new Date("2026-11-20T13:00:00Z");
  await db
    .update(billingCustomers)
    .set({ nextSyncAt: later })
    .where(eq(billingCustomers.userId, userId));
  await db.insert(billingCustomers).values({
    userId: healthyUserId,
    nextSyncAt: later,
  });
  await db.insert(billingProviderCustomers).values([
    { userId, provider: "creem", nextSyncAt: new Date("2026-11-20T11:00:00Z") },
    { userId, provider: "polar", nextSyncAt: later, syncFailures: 2 },
    {
      userId: healthyUserId,
      provider: "creem",
      nextSyncAt: new Date("2026-11-20T11:30:00Z"),
    },
  ]);
  const creem = new FakeBillingProvider();
  let conflicting = true;
  creem.fetchSnapshot = async (id) => {
    if (id === userId && conflicting)
      throw new HttpError(
        409,
        "Conflicting subscriptions",
        "billing_duplicate_subscriptions",
      );
    return { kind: "none" };
  };
  const { syncCustomer } = createBillingSync({
    db,
    providers: { creem, polar: new FakeBillingProvider() },
    config: configFixture(),
    now: () => clock,
  });
  const worker = () =>
    createBillingReconciler({
      db,
      enabledProviders: ["creem", "polar"],
      syncCustomer,
      now: () => clock,
    });
  expect(await worker().reconcileBilling({ limit: 1 })).toEqual({
    processed: 0,
    failed: 1,
  });
  const rows = await db
    .select()
    .from(billingProviderCustomers)
    .where(eq(billingProviderCustomers.userId, userId));
  expect(rows.find((row) => row.provider === "creem")).toMatchObject({
    syncFailures: 1,
    nextSyncAt: new Date("2026-11-20T12:01:00Z"),
  });
  expect(rows.find((row) => row.provider === "polar")).toMatchObject({
    syncFailures: 2,
    nextSyncAt: later,
  });

  clock = new Date("2026-11-20T12:05:00Z");
  expect(await worker().reconcileBilling({ limit: 1 })).toEqual({
    processed: 1,
    failed: 0,
  });
  const [healthy] = await db
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, healthyUserId));
  expect(healthy?.lastSyncedAt).toEqual(clock);

  conflicting = false;
  expect(await worker().reconcileBilling({ limit: 1 })).toEqual({
    processed: 1,
    failed: 0,
  });
  const [recovered] = await db
    .select()
    .from(billingProviderCustomers)
    .where(eq(billingProviderCustomers.userId, userId))
    .orderBy(billingProviderCustomers.provider);
  expect(recovered).toMatchObject({
    provider: "creem",
    syncFailures: 0,
    nextSyncAt: new Date("2026-11-20T12:10:00Z"),
  });
});

it("requires updating verified billing details before routing through another country", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  const polar = new FakeBillingProvider();
  const order = {
    orderId: "country-order",
    productId: "prod_pm",
    start: new Date(Date.now() - 120_000),
    end: new Date(Date.now() - 60_000),
    totalAmount: 900,
    refundedAmount: 0,
    dispute: "none" as const,
  };
  const snapshot: BillingSnapshot = {
    kind: "subscription",
    customerId: "country-customer",
    subscriptionId: "country-sub",
    productId: "prod_pm",
    billingCountry: "GE",
    choice: { tier: "plus", interval: "month" },
    status: "canceled",
    paidPeriod: order,
    orders: [order],
    cancelAtPeriodEnd: true,
    failedRenewal: false,
    revoked: false,
    pendingChange: null,
  };
  await db
    .update(billingCustomers)
    .set({ provider: "creem", snapshot })
    .where(eq(billingCustomers.userId, userId));
  const billing = service(db, { creem, polar }, configFixture("IN=polar"));
  await expect(
    billing.startCheckout({
      userId,
      choice: { tier: "plus", interval: "month", billingCountry: "IN" },
    }),
  ).rejects.toMatchObject({ code: "billing_country_mismatch" });
  expect(creem.created.length + polar.created.length).toBe(0);
});

function providerSnapshot(
  productId: string,
  orderId: string,
  end: Date,
): Extract<BillingSnapshot, { kind: "subscription" }> {
  const order = {
    orderId,
    productId,
    start: new Date(Date.now() - 60_000),
    end,
    totalAmount: 900,
    refundedAmount: 0,
    dispute: "none" as const,
  };
  return {
    kind: "subscription",
    customerId: "customer",
    subscriptionId: "subscription",
    productId,
    choice: { tier: "plus", interval: "month" },
    status: "active",
    paidPeriod: order,
    orders: [order],
    cancelAtPeriodEnd: false,
    failedRenewal: false,
    revoked: false,
    pendingChange: null,
  };
}
it("freezes the last unambiguous paid deadline while conflicting subscriptions need reconciliation", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  const polar = new FakeBillingProvider();
  const config = configFixture();
  const providers = { creem, polar };
  const oldEnd = new Date(Date.now() + 3_600_000);
  creem.snapshots.set(userId, providerSnapshot("prod_pm", "old", oldEnd));
  const sync = createBillingSync({ db, providers, config });
  await sync.syncCustomer({ userId, reason: "refresh" });
  creem.snapshots.set(
    userId,
    providerSnapshot("prod_pm", "new", new Date(Date.now() + 86_400_000)),
  );
  polar.snapshots.set(userId, providerSnapshot("polar_pm", "other", oldEnd));
  await sync.syncCustomer({ userId, provider: "polar", reason: "refresh" });
  expect(await service(db, providers, config).getAccount(userId)).toMatchObject(
    { billingConflict: true, paidThrough: oldEnd.toISOString() },
  );
});
it("retains an unmatched dispute until its authoritative paid transaction can be suspended", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  const config = configFixture();
  const providers = { creem };
  const initial = providerSnapshot(
    "prod_pm",
    "new-order",
    new Date(Date.now() + 3_600_000),
  );
  creem.snapshots.set(userId, { ...initial, orders: [], paidPeriod: null });
  await db
    .insert(billingWebhookInbox)
    .values({
      provider: "creem",
      eventId: "early-dispute",
      eventType: "dispute.created",
      userId,
      customerId: "customer",
      orderId: "new-order",
      dispute: "open",
    });
  const sync = createBillingSync({ db, providers, config });
  await sync.syncCustomer({
    userId,
    provider: "creem",
    reason: "webhook:dispute.created",
  });
  expect(
    (await db.select().from(billingWebhookInbox))[0]?.processedAt,
  ).toBeNull();
  creem.snapshots.set(userId, initial);
  await sync.syncCustomer({ userId, reason: "refresh" });
  expect(await service(db, providers, config).getAccount(userId)).toMatchObject(
    { tier: "free", reason: "disputed" },
  );
});
it("persists another provider refund and retry deadline when an upstream adapter reports HTTP 502", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  const polar = new FakeBillingProvider();
  const config = configFixture();
  const providers = { creem, polar };
  const snapshot = providerSnapshot(
    "prod_pm",
    "paid",
    new Date(Date.now() + 3_600_000),
  );
  creem.snapshots.set(userId, snapshot);
  const sync = createBillingSync({ db, providers, config });
  await sync.syncCustomer({ userId, reason: "refresh" });
  polar.fetchSnapshot = async () => {
    throw new HttpError(502, "Upstream unavailable", "billing_provider_error");
  };
  creem.snapshots.set(userId, {
    ...snapshot,
    orders: snapshot.orders.map((order) => ({ ...order, refundedAmount: 900 })),
  });
  await expect(
    sync.syncCustomer({ userId, provider: "polar", reason: "refresh" }),
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(await service(db, providers, config).getAccount(userId)).toMatchObject(
    { tier: "free", reason: "revoked" },
  );
  const rows = await db.select().from(billingProviderCustomers);
  expect(rows.find((row) => row.provider === "polar")?.syncFailures).toBe(1);
});

it("allows repurchase after a fully refunded period and confirmed cancellation", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  const config = configFixture();
  const providers = { creem };
  const snapshot = providerSnapshot(
    "prod_pm",
    "refunded",
    new Date(Date.now() + 3_600_000),
  );
  creem.snapshots.set(userId, {
    ...snapshot,
    status: "canceled",
    cancelAtPeriodEnd: true,
    orders: snapshot.orders.map((order) => ({ ...order, refundedAmount: 900 })),
  });
  await service(db, providers, config).startCheckout({
    userId,
    choice: { tier: "plus", interval: "month" },
  });
  expect(creem.created).toHaveLength(1);
});

it("keeps a subscription portal available when an unrelated historical provider is offline", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  const polar = new FakeBillingProvider();
  const config = configFixture();
  const providers = { creem, polar };
  creem.snapshots.set(
    userId,
    providerSnapshot("prod_pm", "paid", new Date(Date.now() + 3_600_000)),
  );
  await createBillingSync({ db, providers, config }).syncCustomer({
    userId,
    reason: "refresh",
  });
  await db
    .insert(billingProviderCustomers)
    .values({ userId, provider: "polar", snapshot: { kind: "none" } });
  polar.failFetch = true;
  await expect(
    service(db, providers, config).portal(userId),
  ).resolves.toHaveProperty("url");
});

it.each(["GE", "US"])(
  "persists provider-confirmed country %s against the paid checkout",
  async (country) => {
    const { db, userId } = await setup();
    const creem = new FakeBillingProvider();
    const snapshot = providerSnapshot(
      "prod_pm",
      "country-order",
      new Date(Date.now() + 3_600_000),
    );
    creem.snapshots.set(userId, {
      ...snapshot,
      billingCountry: country,
      orders: snapshot.orders.map((order) => ({
        ...order,
        checkoutId: "country-checkout",
      })),
    });
    await db.insert(billingCheckoutAttempts).values({
      userId,
      provider: "creem",
      attemptId: randomUUID(),
      checkoutId: "country-checkout",
      billingCountry: "GE",
      tier: "plus",
      interval: "month",
    });
    await createBillingSync({
      db,
      providers: { creem },
      config: configFixture(),
    }).syncCustomer({ userId, reason: "refresh" });
    const [customer] = await db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, userId));
    expect(customer?.snapshot).toMatchObject({
      billingCountry: country,
      billingCountryMismatch: country === "US",
    });
    expect((await db.select().from(billingCheckoutAttempts))[0]?.status).toBe(
      "completed",
    );
  },
);

it.each(["subscription", "order"])(
  "rejects a %s identity already owned by another account",
  async (collision) => {
    const { db, userId } = await setup();
    const otherUserId = randomUUID();
    await db
      .insert(users)
      .values({ id: otherUserId, email: `${otherUserId}@test.local` });
    const creem = new FakeBillingProvider();
    const snapshot = providerSnapshot(
      "prod_pm",
      "owned-order",
      new Date(Date.now() + 3_600_000),
    );
    creem.snapshots.set(userId, snapshot);
    const config = configFixture();
    const sync = createBillingSync({ db, providers: { creem }, config });
    await sync.syncCustomer({ userId, reason: "refresh" });
    creem.snapshots.set(otherUserId, {
      ...snapshot,
      customerId: "different-customer",
      subscriptionId:
        collision === "subscription"
          ? "subscription"
          : "different-subscription",
    });
    await expect(
      sync.syncCustomer({ userId: otherUserId, reason: "refresh" }),
    ).rejects.toThrow(
      collision === "subscription"
        ? "Provider subscription identity mismatch"
        : "Provider order identity mismatch",
    );
    expect(
      await db
        .select()
        .from(billingProviderCustomers)
        .where(eq(billingProviderCustomers.userId, otherUserId)),
    ).toEqual([]);
    expect(
      await service(db, { creem }, config).getAccount(userId),
    ).toMatchObject({ tier: "plus" });
  },
);

it("does not create checkout when the selected enabled provider has no adapter", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  await expect(
    service(db, { creem }, configFixture("IN=polar")).startCheckout({
      userId,
      choice: { tier: "plus", interval: "month", billingCountry: "IN" },
    }),
  ).rejects.toMatchObject({ statusCode: 503, code: "billing_unavailable" });
  expect(creem.created).toEqual([]);
  expect(await db.select().from(billingCheckoutAttempts)).toEqual([]);
});
