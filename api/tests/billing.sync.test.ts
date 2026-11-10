import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createPgliteClient } from "../src/db/client.js";
import {
  users,
  billingCustomers,
  billingWebhookInbox,
  billingOrders,
} from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/config/env.js";
import { buildPlanCatalog } from "../src/modules/billing/catalog.js";
import { createEntitlementService } from "../src/modules/billing/entitlements.js";
import { createBillingSync } from "../src/modules/billing/sync.js";
import { createBillingReconciler } from "../src/modules/billing/reconcile.js";
import { FakeBillingProvider } from "./helpers/fake-billing-provider.js";
import type {
  BillingSnapshot,
  PaidOrder,
} from "../src/modules/billing/billing.schema.js";
export const testConfig = () =>
  loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
    BILLING_ENABLED: "true",
    POLAR_ACCESS_TOKEN: "test-token",
    POLAR_WEBHOOK_SECRET: "test-secret",
    POLAR_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
    POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-year",
  });
export const paidOrder = (extra: Partial<PaidOrder> = {}): PaidOrder => ({
  orderId: "order",
  productId: "plus-month",
  start: new Date("2026-10-10Z"),
  end: new Date("2026-11-10Z"),
  totalAmount: 900,
  refundedAmount: 0,
  dispute: "none",
  ...extra,
});
export const paidSnapshot = (
  extra: Partial<Extract<BillingSnapshot, { kind: "subscription" }>> = {},
): BillingSnapshot => ({
  kind: "subscription",
  customerId: "customer",
  subscriptionId: "subscription",
  productId: "plus-month",
  choice: { tier: "plus", interval: "month" },
  status: "active",
  paidPeriod: paidOrder(),
  orders: [paidOrder()],
  cancelAtPeriodEnd: false,
  failedRenewal: false,
  revoked: false,
  pendingChange: null,
  ...extra,
});
describe("authoritative billing synchronization", () => {
  let handle: ReturnType<typeof createPgliteClient>;
  let userId: string;
  let provider: FakeBillingProvider;
  const now = () => new Date("2026-11-09Z");
  beforeEach(async () => {
    handle = createPgliteClient(new PGlite());
    await migrate(handle.db, { migrationsFolder: "src/db/migrations" });
    userId = randomUUID();
    await handle.db
      .insert(users)
      .values({ id: userId, email: `${userId}@test.com` });
    provider = new FakeBillingProvider();
  });
  afterEach(async () => handle.close());
  function services() {
    const catalog = buildPlanCatalog(testConfig());
    return {
      ...createBillingSync({
        db: handle.db,
        provider,
        config: testConfig(),
        now,
      }),
      ...createEntitlementService({ db: handle.db, catalog, now }),
    };
  }
  it("grants only verified paid orders, ignores unknown product and unpaid initial checkout", async () => {
    const service = services();
    for (const snapshot of [
      paidSnapshot({ paidPeriod: null, orders: [] }),
      paidSnapshot({
        productId: "unknown",
        choice: null,
        paidPeriod: paidOrder({ productId: "unknown" }),
        orders: [paidOrder({ productId: "unknown" })],
      }),
    ]) {
      provider.snapshots.set(userId, snapshot);
      await service.syncCustomer({ userId, reason: "test" });
      expect((await service.resolveEntitlements(userId)).tier).toBe("free");
    }
    provider.snapshots.set(userId, paidSnapshot());
    await service.syncCustomer({ userId, reason: "paid" });
    expect((await service.resolveEntitlements(userId)).tier).toBe("plus");
  });
  it("keeps newer paid renewal through historical refund in both event orders", async () => {
    const service = services();
    const old = paidOrder({
      orderId: "old",
      end: new Date("2026-10-10Z"),
      start: new Date("2026-09-10Z"),
      refundedAmount: 900,
    });
    for (const orders of [
      [old, paidOrder()],
      [paidOrder(), old],
    ]) {
      provider.snapshots.set(userId, paidSnapshot({ orders }));
      await service.syncCustomer({ userId, reason: "refund" });
      expect((await service.resolveEntitlements(userId)).tier).toBe("plus");
    }
    expect(provider.revoked).toEqual([]);
  });
  it("suspends open/lost dispute, preserves unresolved evidence on missing dispute and restores only won", async () => {
    const service = services();
    for (const dispute of ["open", "none", "lost", "none", "won"] as const) {
      const order = paidOrder({ dispute });
      provider.snapshots.set(
        userId,
        paidSnapshot({ paidPeriod: order, orders: [order] }),
      );
      await service.syncCustomer({ userId, reason: "dispute" });
      expect((await service.resolveEntitlements(userId)).tier).toBe(
        dispute === "won" ? "plus" : "free",
      );
    }
  });
  it("revokes current full refund but preserves partial refund and newer paid order choice", async () => {
    const service = services();
    provider.snapshots.set(
      userId,
      paidSnapshot({
        choice: { tier: "supporter", interval: "year" },
        productId: "supporter-year",
      }),
    );
    await service.syncCustomer({ userId, reason: "unpaid upgrade" });
    expect((await service.resolveEntitlements(userId)).tier).toBe("plus");
    for (const refundedAmount of [10, 900]) {
      const order = paidOrder({ refundedAmount });
      provider.snapshots.set(
        userId,
        paidSnapshot({ paidPeriod: order, orders: [order] }),
      );
      await service.syncCustomer({ userId, reason: "refund" });
      expect((await service.resolveEntitlements(userId)).tier).toBe(
        refundedAmount === 900 ? "free" : "plus",
      );
    }
    expect(provider.revoked).toEqual(["subscription"]);
  });
  it("propagates provider errors without extending access and reconciliation retries inbox", async () => {
    const service = services();
    provider.snapshots.set(userId, paidSnapshot());
    await service.syncCustomer({ userId, reason: "initial" });
    provider.failFetch = true;
    await expect(
      service.syncCustomer({ userId, reason: "failure" }),
    ).rejects.toThrow();
    expect((await service.resolveEntitlements(userId)).tier).toBe("plus");
    await handle.db
      .insert(billingWebhookInbox)
      .values({ eventId: "retry", eventType: "order.paid", userId });
    provider.failFetch = false;
    const reconciler = createBillingReconciler({
      db: handle.db,
      syncCustomer: service.syncCustomer,
    });
    expect(await reconciler.reconcileBilling({ limit: 10 })).toEqual({
      processed: 1,
      failed: 0,
    });
    expect(
      (
        await handle.db
          .select()
          .from(billingWebhookInbox)
          .where(eq(billingWebhookInbox.eventId, "retry"))
      )[0]?.processedAt,
    ).not.toBeNull();
    expect(await handle.db.select().from(billingOrders)).toHaveLength(1);
  });
  it("does not revoke unknown provider products after full refund", async () => {
    const service = services();
    const order = paidOrder({ productId: "unrecognized", refundedAmount: 900 });
    provider.snapshots.set(
      userId,
      paidSnapshot({
        productId: "unrecognized",
        choice: null,
        paidPeriod: order,
        orders: [order],
      }),
    );
    await service.syncCustomer({ userId, reason: "unknown refund" });
    expect(provider.revoked).toEqual([]);
    expect((await service.resolveEntitlements(userId)).tier).toBe("free");
  });
  it("gives later accounts a reconciliation turn after a poison customer fails", async () => {
    const otherUserId = randomUUID();
    await handle.db
      .insert(users)
      .values({ id: otherUserId, email: `${otherUserId}@test.com` });
    await handle.db
      .insert(billingCustomers)
      .values([{ userId }, { userId: otherUserId }]);
    provider.failFetchFor.add(userId);
    const service = services();
    const reconciler = createBillingReconciler({
      db: handle.db,
      syncCustomer: service.syncCustomer,
    });
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 0,
      failed: 1,
    });
    const restarted = createBillingReconciler({
      db: handle.db,
      syncCustomer: service.syncCustomer,
    });
    expect(await restarted.reconcileBilling({ limit: 1 })).toEqual({
      processed: 1,
      failed: 0,
    });
    const [customer] = await handle.db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, otherUserId));
    expect(customer?.lastSyncedAt).not.toBeNull();
  });
  it("moves unbound inbox deliveries aside so newer known accounts are synchronized", async () => {
    await handle.db.insert(billingWebhookInbox).values([
      {
        eventId: "unbound",
        eventType: "order.paid",
        customerId: "missing",
        receivedAt: new Date("2026-01-01Z"),
      },
      {
        eventId: "known",
        eventType: "order.paid",
        userId,
        receivedAt: new Date("2026-01-02Z"),
      },
    ]);
    const service = services();
    const reconciler = createBillingReconciler({
      db: handle.db,
      syncCustomer: service.syncCustomer,
    });
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 0,
      failed: 1,
    });
    const restarted = createBillingReconciler({
      db: handle.db,
      syncCustomer: service.syncCustomer,
    });
    expect(await restarted.reconcileBilling({ limit: 1 })).toEqual({
      processed: 1,
      failed: 0,
    });
    const [deferred] = await handle.db
      .select()
      .from(billingWebhookInbox)
      .where(eq(billingWebhookInbox.eventId, "unbound"));
    expect(deferred?.syncFailures).toBe(1);
    expect(deferred?.nextSyncAt.getTime()).toBeGreaterThan(Date.now());
  });
});
