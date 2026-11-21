import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, expect, it, vi } from "vitest";
import { createPgliteClient } from "./helpers/db.js";
import { loadEnv } from "../src/config/env.js";
import {
  billingCustomers,
  billingCheckoutAttempts,
  billingSubscriptions,
  billingOrders,
  billingProviderCustomers,
  billingWebhookInbox,
  users,
} from "../src/db/schema.js";
import { createBillingSync, providerReferences } from "../src/modules/billing/sync.js";
import { FakeBillingProvider } from "./helpers/fake-billing-provider.js";
import { createBillingService } from "../src/modules/billing/billing.service.js";
import { buildPlanCatalog } from "../src/modules/billing/catalog.js";
import { createEntitlementService } from "../src/modules/billing/entitlements.js";
import type { BillingProvider } from "../src/modules/billing/provider.js";
import type { BillingSnapshot } from "../src/modules/billing/billing.schema.js";
import { createBillingReconciler } from "../src/modules/billing/reconcile.js";
import { eq } from "drizzle-orm";
import { createCreemProvider } from "../src/modules/billing/creem.js";
import { HttpError } from "../src/plugins/errors.js";

const handles: ReturnType<typeof createPgliteClient>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
  await db
    .insert(billingProviderCustomers)
    .values({ userId, provider: "polar", customerId: "disabled-polar" });
  const fetchPolar = vi.spyOn(polar, "fetchSnapshot");
  const sync = createBillingSync({ db, providers: { polar, creem }, config });
  await expect(
    sync.syncCustomer({ userId, reason: "refresh" }),
  ).resolves.toBeUndefined();
  expect(fetchPolar).not.toHaveBeenCalled();
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
  const outcomes = await Promise.allSettled([
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
  const attempts = await db.select().from(billingCheckoutAttempts);
  expect(attempts).toHaveLength(1);
  const urls = outcomes.flatMap((result) =>
    result.status === "fulfilled" ? [result.value.url] : [],
  );
  expect(urls.length).toBeGreaterThan(0);
  expect(urls).toContain(attempts[0]?.url);
  expect(attempts[0]?.status).toBe("pending");
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
        "billing_identity_mismatch",
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

it.each([undefined, "US", "CA"])(
  "uses freshly verified country %s under the checkout admission lock",
  async (country) => {
    const { db, userId } = await setup();
    const creem = new FakeBillingProvider();
    const expired = providerSnapshot(
      "prod_pm",
      "expired",
      new Date(Date.now() - 60_000),
    );
    creem.snapshots.set(userId, {
      ...expired,
      billingCountry: country,
      status: "canceled",
      cancelAtPeriodEnd: true,
    });
    const checkout = service(db, { creem }).startCheckout({
      userId,
      choice: { tier: "plus", interval: "month", billingCountry: "US" },
    });
    if (country === "CA") {
      await expect(checkout).rejects.toMatchObject({
        code: "billing_country_mismatch",
      });
      expect(creem.created).toEqual([]);
      expect(await db.select().from(billingCheckoutAttempts)).toEqual([]);
    } else await expect(checkout).resolves.toHaveProperty("url");
  },
);

it("retains the original provider for same-country retries and blocks another country", async () => {
  const { db, userId } = await setup();
  const fake = new FakeBillingProvider();
  const creem: BillingProvider = {
    fetchSnapshot: fake.fetchSnapshot.bind(fake),
    createCheckout: fake.createCheckout.bind(fake),
    findCheckout: fake.findCheckout.bind(fake),
    createPortal: fake.createPortal.bind(fake),
    scheduleChange: fake.scheduleChange.bind(fake),
    revokeSubscription: fake.revokeSubscription.bind(fake),
  };
  const polar = new FakeBillingProvider();
  const providers = { creem, polar };
  const first = await service(db, providers).startCheckout({
    userId,
    choice: { tier: "plus", interval: "month", billingCountry: "US" },
  });
  const rerouted = service(db, providers, configFixture("US=polar,CA=polar"));
  await expect(
    rerouted.startCheckout({
      userId,
      choice: { tier: "plus", interval: "month", billingCountry: "US" },
    }),
  ).resolves.toEqual(first);
  await expect(
    rerouted.startCheckout({
      userId,
      choice: { tier: "plus", interval: "month", billingCountry: "CA" },
    }),
  ).rejects.toMatchObject({ code: "billing_checkout_conflict" });
  expect(fake.created).toHaveLength(1);
  expect(polar.created).toEqual([]);
});

it("rolls back admission when the customer lookup fails before any checkout POST", async () => {
  const { db, client, userId } = await setup();
  const creem = new FakeBillingProvider();
  const config = configFixture();
  const catalog = buildPlanCatalog(config);
  let fail = true;
  const billing = createBillingService({
    productName: "CareerSIM",
    db,
    config,
    catalog,
    providers: { creem },
    ...createEntitlementService({ db, catalog }),
    syncCustomer: async () => {
      if (fail) {
        fail = false;
        await client.exec(
          "ALTER TABLE billing_provider_customers RENAME TO unavailable_customers",
        );
      }
    },
  });
  await expect(
    billing.startCheckout({
      userId,
      choice: { tier: "plus", interval: "month" },
    }),
  ).rejects.toThrow();
  await client.exec(
    "ALTER TABLE unavailable_customers RENAME TO billing_provider_customers",
  );
  expect(creem.created).toEqual([]);
  expect(await db.select().from(billingCheckoutAttempts)).toEqual([]);
  await expect(
    billing.startCheckout({
      userId,
      choice: { tier: "plus", interval: "month" },
    }),
  ).resolves.toHaveProperty("url");
  expect(creem.created).toHaveLength(1);
});

it.each(["creem", "polar"] as const)(
  "commits a Polar refund when %s runs first and Creem reports duplicate subscriptions",
  async (first) => {
    const { db, userId } = await setup();
    const creem = new FakeBillingProvider();
    const polar = new FakeBillingProvider();
    const config = configFixture();
    const providers = { creem, polar };
    const paid = providerSnapshot(
      "polar_pm",
      "refunded",
      new Date(Date.now() + 3_600_000),
    );
    polar.snapshots.set(userId, paid);
    const sync = createBillingSync({ db, providers, config });
    await sync.syncCustomer({ userId, provider: "polar", reason: "refresh" });
    expect(
      await service(db, providers, config).getAccount(userId),
    ).toMatchObject({ tier: "plus" });
    creem.fetchSnapshot = async () => {
      throw new HttpError(409, "Duplicate", "billing_duplicate_subscriptions");
    };
    polar.snapshots.set(userId, {
      ...paid,
      orders: paid.orders.map((order) => ({ ...order, refundedAmount: 900 })),
    });
    await expect(
      sync.syncCustomer({ userId, provider: first, reason: "refresh" }),
    ).resolves.toBeUndefined();
    expect(
      await service(db, providers, config).getAccount(userId),
    ).toMatchObject({ billingConflict: true, tier: "free", reason: "revoked" });
    const [conflicting] = await db
      .select()
      .from(billingProviderCustomers)
      .where(eq(billingProviderCustomers.provider, "creem"));
    expect(conflicting).toMatchObject({ billingConflict: 1, syncFailures: 1 });
    await sync.syncCustomer({
      userId,
      reason: "reconciliation",
      reconcileAt: new Date(),
    });
    expect(
      await service(db, providers, config).getAccount(userId),
    ).toMatchObject({ billingConflict: true, tier: "free" });
  },
);

it("skips an unconfigured default without hiding a known Polar renewal", async () => {
  const { db, userId } = await setup();
  const polar = new FakeBillingProvider();
  polar.snapshots.set(
    userId,
    providerSnapshot("polar_pm", "renewal", new Date(Date.now() + 3_600_000)),
  );
  await db
    .insert(billingProviderCustomers)
    .values({ userId, provider: "polar", customerId: "customer" });
  const config = {
    ...configFixture(),
    BILLING_ENABLED: false,
    CREEM_API_KEY: "",
  };
  const sync = createBillingSync({ db, providers: { polar }, config });
  await expect(
    sync.syncCustomer({ userId, reason: "refresh" }),
  ).resolves.toBeUndefined();
  expect(
    (await db.select().from(billingProviderCustomers)).map(
      (row) => row.provider,
    ),
  ).toEqual(["polar"]);
  expect(
    await createEntitlementService({
      db,
      catalog: buildPlanCatalog(config),
    }).resolveEntitlements(userId),
  ).toMatchObject({ tier: "plus" });
});

it("opens the Creem portal without retrying a historical Polar cancellation", async () => {
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
    .insert(billingSubscriptions)
    .values({
      userId,
      provider: "polar",
      subscriptionId: "old-polar",
      productId: "polar_pm",
      status: "canceled",
      revokePending: 1,
    });
  polar.failFetch = true;
  const fetchPolar = vi.spyOn(polar, "fetchSnapshot");
  await expect(
    service(db, providers, config).portal(userId),
  ).resolves.toHaveProperty("url");
  expect(fetchPolar).not.toHaveBeenCalled();
  expect(
    (
      await db
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.provider, "polar"))
    )[0]?.revokePending,
  ).toBe(1);
});

it("defers a known-user dispute with no order so the next payment gets a bounded batch", async () => {
  const { db, userId } = await setup();
  const other = randomUUID();
  const clock = new Date();
  await db.insert(users).values({ id: other, email: `${other}@test.local` });
  await db.insert(billingCustomers).values({ userId: other });
  await db.insert(billingWebhookInbox).values([
    {
      provider: "creem",
      userId,
      eventId: "older-dispute",
      eventType: "dispute.created",
      orderId: "unknown",
      dispute: "open",
      nextSyncAt: new Date(clock.getTime() - 2000),
    },
    {
      provider: "creem",
      userId: other,
      eventId: "newer-payment",
      eventType: "subscription.paid",
      nextSyncAt: new Date(clock.getTime() - 1000),
    },
  ]);
  const sync = createBillingSync({
    db,
    providers: { creem: new FakeBillingProvider() },
    config: configFixture(),
    now: () => clock,
  });
  const worker = createBillingReconciler({
    db,
    enabledProviders: ["creem"],
    ...sync,
    now: () => clock,
  });
  expect(await worker.reconcileBilling({ limit: 1 })).toEqual({
    processed: 1,
    failed: 0,
  });
  const [deferred] = await db
    .select()
    .from(billingWebhookInbox)
    .where(eq(billingWebhookInbox.eventId, "older-dispute"));
  expect(deferred?.processedAt).toBeNull();
  expect(deferred?.syncFailures).toBe(1);
  expect(deferred?.nextSyncAt.getTime()).toBeGreaterThan(clock.getTime());
  expect(await worker.reconcileBilling({ limit: 1 })).toEqual({
    processed: 1,
    failed: 0,
  });
  const [payment] = await db
    .select()
    .from(billingWebhookInbox)
    .where(eq(billingWebhookInbox.eventId, "newer-payment"));
  expect(payment?.processedAt).toEqual(clock);
});

it("resets retries only for the provider/event pairs actually processed", async () => {
  const { db, userId } = await setup();
  const other = randomUUID();
  const clock = new Date();
  const future = new Date(clock.getTime() + 3_600_000);
  await db.insert(users).values({ id: other, email: `${other}@test.local` });
  await db.insert(billingWebhookInbox).values([
    {
      provider: "polar",
      userId,
      eventId: "same",
      eventType: "order.paid",
      nextSyncAt: clock,
      syncFailures: 2,
    },
    {
      provider: "creem",
      userId: other,
      eventId: "same",
      eventType: "subscription.paid",
      nextSyncAt: future,
      syncFailures: 4,
    },
  ]);
  const worker = createBillingReconciler({
    db,
    enabledProviders: ["creem", "polar"],
    now: () => clock,
    syncCustomer: async () => {
      await db
        .update(billingWebhookInbox)
        .set({ processedAt: clock })
        .where(eq(billingWebhookInbox.provider, "polar"));
    },
  });
  await worker.reconcileBilling({ limit: 1 });
  const rows = await db.select().from(billingWebhookInbox);
  expect(rows.find((row) => row.provider === "polar")).toMatchObject({
    syncFailures: 0,
    processedAt: clock,
  });
  expect(rows.find((row) => row.provider === "creem")).toMatchObject({
    syncFailures: 4,
    processedAt: null,
    nextSyncAt: future,
  });
});

it("persists verified checkout linkage before removing completed checkouts from live reads", async () => {
  const { db, userId } = await setup();
  const attemptId = randomUUID();
  const start = Date.now() - 60_000;
  const end = Date.now() + 3_600_000;
  await db
    .insert(billingCheckoutAttempts)
    .values({
      userId,
      provider: "creem",
      attemptId,
      checkoutId: "checkout",
      tier: "plus",
      interval: "month",
      status: "pending",
    });
  let failOldCheckout = false;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/checkouts") {
      if (failOldCheckout) throw new Error("Historical checkout unavailable");
      return Response.json({
        id: "checkout",
        status: "completed",
        checkout_url: "https://creem.io/checkout",
        product: "prod_pm",
        customer: "customer",
        subscription: "subscription",
        order: { id: "order", product: "prod_pm" },
        request_id: attemptId,
        metadata: {
          careersim_user_id: userId,
          careersim_attempt_id: attemptId,
        },
      });
    }
    if (url.pathname === "/v1/subscriptions")
      return Response.json({
        id: "subscription",
        status: "active",
        customer: "customer",
        product: "prod_pm",
        created_at: new Date(start).toISOString(),
        current_period_start_date: new Date(start).toISOString(),
        current_period_end_date: new Date(end).toISOString(),
        last_transaction_id: "transaction",
      });
    return Response.json({
      items: [
        {
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
          period_start: start,
          period_end: end,
        },
      ],
      pagination: { current_page: 1, next_page: null },
    });
  });
  const config = configFixture();
  const creem = createCreemProvider(config, fetcher);
  const sync = createBillingSync({ db, providers: { creem }, config });
  await sync.syncCustomer({ userId, reason: "refresh" });
  expect((await db.select().from(billingOrders))[0]).toMatchObject({
    checkoutId: "checkout",
    orderId: "transaction",
  });
  expect((await db.select().from(billingCheckoutAttempts))[0]?.status).toBe(
    "completed",
  );
  fetcher.mockClear();
  failOldCheckout = true;
  await expect(
    sync.syncCustomer({ userId, reason: "refresh" }),
  ).resolves.toBeUndefined();
  expect(
    fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname),
  ).toEqual(["/v1/subscriptions", "/v1/transactions/search"]);
  expect(await service(db, { creem }, config).getAccount(userId)).toMatchObject(
    { tier: "plus" },
  );
});

it.each(["refund", "dispute"])(
  "applies verified %s restrictions to a frozen snapshot during conflict",
  async (restriction) => {
    const { db, userId } = await setup();
    const creem = new FakeBillingProvider();
    const polar = new FakeBillingProvider();
    const config = configFixture();
    const providers = { creem, polar };
    const paid = providerSnapshot(
      "prod_pm",
      "frozen",
      new Date(Date.now() + 3_600_000),
    );
    creem.snapshots.set(userId, paid);
    const sync = createBillingSync({ db, providers, config });
    await sync.syncCustomer({ userId, reason: "refresh" });
    polar.snapshots.set(
      userId,
      providerSnapshot("polar_pm", "other", new Date(Date.now() + 3_600_000)),
    );
    await sync.syncCustomer({ userId, provider: "polar", reason: "refresh" });
    expect(
      await service(db, providers, config).getAccount(userId),
    ).toMatchObject({ billingConflict: true, tier: "plus" });
    creem.snapshots.set(userId, {
      ...paid,
      orders: paid.orders.map((order) => ({
        ...order,
        refundedAmount: restriction === "refund" ? 900 : null,
        dispute: restriction === "dispute" ? "open" : "none",
      })),
    });
    await sync.syncCustomer({ userId, reason: "refresh" });
    expect(
      await service(db, providers, config).getAccount(userId),
    ).toMatchObject({
      billingConflict: true,
      tier: "free",
      reason: restriction === "refund" ? "revoked" : "disputed",
    });
  },
);

it("passes only provider-scoped stored and pending dispute evidence to the adapter", async () => {
  const { db, userId } = await setup();
  const creem = new FakeBillingProvider();
  creem.snapshots.set(
    userId,
    providerSnapshot("prod_pm", "stored", new Date(Date.now() + 3_600_000)),
  );
  await createBillingSync({
    db,
    providers: { creem },
    config: configFixture(),
  }).syncCustomer({ userId, reason: "refresh" });
  await db.update(billingOrders).set({ dispute: "lost" });
  await db.insert(billingWebhookInbox).values([
    {
      userId,
      provider: "creem",
      eventId: "pending",
      eventType: "dispute.created",
      orderId: "pending-order",
      dispute: "open",
    },
    {
      userId,
      provider: "polar",
      eventId: "other-provider",
      eventType: "dispute.created",
      orderId: "foreign-order",
      dispute: "open",
    },
    {
      userId,
      provider: "creem",
      eventId: "processed",
      eventType: "dispute.created",
      orderId: "processed-order",
      dispute: "open",
      processedAt: new Date(),
    },
  ]);
  expect((await providerReferences(db, userId, "creem")).disputes).toEqual([
    { orderId: "stored", dispute: "lost" },
    { orderId: "pending-order", dispute: "open" },
  ]);
});
