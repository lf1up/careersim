import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createPgliteClient } from "./helpers/db.js";
import { loadEnv } from "../src/config/env.js";
import {
  billingCustomers,
  billingOrders,
  billingProviderCustomers,
  billingSubscriptions,
  billingWebhookInbox,
  users,
} from "../src/db/schema.js";
import { createBillingSync } from "../src/modules/billing/sync.js";
import type { BillingSnapshot } from "../src/modules/billing/billing.schema.js";
import type { BillingProviderId } from "../src/modules/billing/routing.js";
import { FakeBillingProvider } from "./helpers/fake-billing-provider.js";
import { HttpError } from "../src/plugins/errors.js";

const handles: ReturnType<typeof createPgliteClient>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) await handle.close();
});
function refunded(
  provider: BillingProviderId,
): Extract<BillingSnapshot, { kind: "subscription" }> {
  const order = {
    orderId: "refunded",
    productId: `${provider}-month`,
    start: new Date("2026-11-01Z"),
    end: new Date("2026-12-01Z"),
    totalAmount: 900,
    refundedAmount: 900,
    dispute: "none" as const,
  };
  return {
    kind: "subscription",
    customerId: `${provider}-customer`,
    subscriptionId: `${provider}-subscription`,
    productId: order.productId,
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
async function setup() {
  const handle = createPgliteClient(new PGlite());
  handles.push(handle);
  await migrate(handle.db, { migrationsFolder: "src/db/migrations" });
  const userId = randomUUID();
  await handle.db
    .insert(users)
    .values({ id: userId, email: `${userId}@test.local` });
  await handle.db.insert(billingCustomers).values({ userId });
  const clock = { now: new Date("2026-11-21Z") };
  const providers = {
    creem: new FakeBillingProvider(),
    polar: new FakeBillingProvider(),
  };
  const config = loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
    POLAR_ENABLED: "true",
    CREEM_PLUS_MONTHLY_PRODUCT_ID: "creem-month",
    POLAR_PLUS_MONTHLY_PRODUCT_ID: "polar-month",
  });
  const sync = createBillingSync({
    db: handle.db,
    providers,
    config,
    now: () => clock.now,
  });
  async function pending(provider: BillingProviderId, nextSyncAt = clock.now) {
    const snapshot = refunded(provider);
    providers[provider].snapshots.set(userId, snapshot);
    await handle.db.insert(billingProviderCustomers).values({
      userId,
      provider,
      customerId: snapshot.customerId,
      snapshot,
      nextSyncAt,
    });
    await handle.db.insert(billingSubscriptions).values({
      userId,
      provider,
      subscriptionId: snapshot.subscriptionId,
      productId: snapshot.productId,
      status: "active",
      revokePending: 1,
      paidThrough: snapshot.paidPeriod?.end,
    });
    const order = snapshot.orders[0];
    if (!order) throw new Error("Missing paid fixture");
    await handle.db.insert(billingOrders).values({
      provider,
      orderId: order.orderId,
      subscriptionId: snapshot.subscriptionId,
      productId: order.productId,
      periodStart: order.start,
      periodEnd: order.end,
      totalAmount: 900,
      refundedAmount: 900,
    });
  }
  return { ...handle, userId, clock, providers, pending, ...sync };
}
it.each(["not-due", "due", "due-delivery"])(
  "honors provider cancellation eligibility for %s reconciliation",
  async (state) => {
    const f = await setup();
    await f.pending(
      "polar",
      state === "due" ? f.clock.now : new Date("2026-11-21T01:00:00Z"),
    );
    if (state === "due-delivery")
      await f.db.insert(billingWebhookInbox).values({
        userId: f.userId,
        provider: "polar",
        eventId: "due",
        eventType: "order.paid",
        nextSyncAt: f.clock.now,
      });
    f.providers.polar.failFetch = state === "not-due";
    const fetch = vi.spyOn(f.providers.polar, "fetchSnapshot");
    await expect(
      f.syncCustomer({
        userId: f.userId,
        reason: "reconciliation",
        reconcileAt: f.clock.now,
      }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(state === "not-due" ? 0 : 2);
    expect(
      (await f.db.select().from(billingSubscriptions))[0]?.revokePending,
    ).toBe(state === "not-due" ? 1 : 2);
  },
);
it.each(["creem", "polar"] as const)(
  "keeps successful cancellation committed when %s fails and retries only after backoff",
  async (failed) => {
    const f = await setup();
    await f.pending("creem");
    await f.pending("polar");
    const error = new HttpError(
      503,
      "Cancellation offline",
      "billing_unavailable",
    );
    const reject = vi
      .spyOn(f.providers[failed], "revokeSubscription")
      .mockRejectedValue(error);
    const healthy = failed === "creem" ? "polar" : "creem";
    await expect(
      f.syncCustomer({ userId: f.userId, reason: "refresh" }),
    ).rejects.toBe(error);
    let rows = await f.db.select().from(billingSubscriptions);
    expect(rows.find((row) => row.provider === healthy)?.revokePending).toBe(2);
    expect(rows.find((row) => row.provider === failed)?.revokePending).toBe(1);
    expect(f.providers[healthy].revoked).toEqual([`${healthy}-subscription`]);
    const [retry] = await f.db
      .select()
      .from(billingProviderCustomers)
      .where(eq(billingProviderCustomers.provider, failed));
    expect(retry).toMatchObject({
      syncFailures: 1,
      nextSyncAt: new Date("2026-11-21T00:01:00Z"),
    });
    reject.mockRestore();
    await f.syncCustomer({
      userId: f.userId,
      reason: "reconciliation",
      reconcileAt: f.clock.now,
    });
    expect(f.providers[failed].revoked).toEqual([]);
    f.clock.now = new Date("2026-11-21T00:01:00Z");
    await f.syncCustomer({
      userId: f.userId,
      reason: "reconciliation",
      reconcileAt: f.clock.now,
    });
    rows = await f.db.select().from(billingSubscriptions);
    expect(rows.every((row) => row.revokePending === 2)).toBe(true);
    expect(f.providers[failed].revoked).toEqual([`${failed}-subscription`]);
    expect(f.providers[healthy].revoked).toEqual([`${healthy}-subscription`]);
  },
);
it.each(["unknown-refund", "missing-order", "contradictory-refund"])(
  "retains the cancellation intent for %s evidence",
  async (state) => {
    const f = await setup();
    await f.pending("creem");
    const initial = refunded("creem");
    const orders =
      state === "missing-order"
        ? []
        : initial.orders.map((order) => ({
            ...order,
            refundedAmount: state === "unknown-refund" ? null : 0,
            dispute:
              state === "unknown-refund"
                ? ("open" as const)
                : ("none" as const),
          }));
    f.providers.creem.snapshots.set(f.userId, { ...initial, orders });
    await f.syncCustomer({ userId: f.userId, reason: "refresh" });
    await f.syncCustomer({ userId: f.userId, reason: "refresh" });
    expect(
      (await f.db.select().from(billingSubscriptions))[0]?.revokePending,
    ).toBe(1);
    expect((await f.db.select().from(billingOrders))[0]?.refundedAmount).toBe(
      900,
    );
    expect(f.providers.creem.revoked).toEqual([]);
  },
);

it("does not retry other intents at a provider that failed earlier in the same pass", async () => {
  const f = await setup();
  await f.pending("creem");
  await f.db
    .insert(billingSubscriptions)
    .values({
      userId: f.userId,
      provider: "creem",
      subscriptionId: "historical",
      productId: "creem-month",
      status: "canceled",
      revokePending: 1,
    });
  const error = new HttpError(503, "Provider offline", "billing_unavailable");
  const fetch = vi
    .spyOn(f.providers.creem, "fetchSnapshot")
    .mockResolvedValueOnce(refunded("creem"))
    .mockRejectedValue(error);
  await expect(
    f.syncCustomer({
      userId: f.userId,
      reason: "reconciliation",
      reconcileAt: f.clock.now,
    }),
  ).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(2);
  const [customer] = await f.db.select().from(billingProviderCustomers);
  expect(customer?.syncFailures).toBe(1);
  expect(
    (await f.db.select().from(billingSubscriptions)).every(
      (row) => row.revokePending === 1,
    ),
  ).toBe(true);
});
