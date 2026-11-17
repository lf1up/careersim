import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createPgliteClient } from "./helpers/db.js";
import {
  users,
  billingCustomers,
  billingProviderCustomers,
  billingWebhookInbox,
  billingOrders,
  billingSubscriptions,
} from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { loadEnv } from "../src/config/env.js";
import { buildPlanCatalog } from "../src/modules/billing/catalog.js";
import { createEntitlementService } from "../src/modules/billing/entitlements.js";
import { createBillingSync } from "../src/modules/billing/sync.js";
import { createBillingReconciler } from "../src/modules/billing/reconcile.js";
import { FakeBillingProvider } from "./helpers/fake-billing-provider.js";
import { HttpError } from "../src/plugins/errors.js";
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
    CREEM_ENABLED: "false",
    POLAR_ENABLED: "true",
    BILLING_DEFAULT_PROVIDER: "polar",
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
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await handle.close();
  });
  function services() {
    const catalog = buildPlanCatalog(testConfig());
    return {
      ...createBillingSync({
        db: handle.db,
        providers: { polar: provider },
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
        choice: { tier: "pro", interval: "year" },
        productId: "pro-year",
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
      enabledProviders: ["polar"],
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
  it("retains stored paid periods and dispute evidence when the provider omits their orders", async () => {
    const service = services();
    const order = paidOrder({ refundedAmount: 100 });
    provider.snapshots.set(userId, paidSnapshot({ orders: [order] }));
    await service.syncCustomer({ userId, reason: "initial payment" });
    provider.snapshots.set(
      userId,
      paidSnapshot({ paidPeriod: null, orders: [] }),
    );

    for (const [dispute, tier] of [
      ["none", "plus"],
      ["open", "free"],
      ["lost", "free"],
      ["won", "plus"],
      ["legacy-value", "plus"],
    ]) {
      await handle.db
        .update(billingOrders)
        .set({ dispute })
        .where(eq(billingOrders.orderId, "order"));
      await service.syncCustomer({
        userId,
        reason: "provider history omitted",
      });
      expect((await service.resolveEntitlements(userId)).tier).toBe(tier);
      const [customer] = await handle.db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.userId, userId));
      expect(customer?.snapshot).toMatchObject({
        paidPeriod: {
          orderId: "order",
          refundedAmount: 100,
          dispute: dispute === "legacy-value" ? "none" : dispute,
        },
      });
    }
    expect(provider.revoked).toEqual([]);
  });
  it("preserves explicit provider conflicts and malformed payment errors without replacing verified access", async () => {
    const service = services();
    provider.snapshots.set(userId, paidSnapshot());
    await service.syncCustomer({ userId, reason: "initial payment" });
    const conflict = new HttpError(
      409,
      "Duplicate subscriptions",
      "billing_duplicate_subscriptions",
    );
    vi.spyOn(provider, "fetchSnapshot").mockRejectedValueOnce(conflict);
    await expect(
      service.syncCustomer({ userId, reason: "duplicate" }),
    ).rejects.toBe(conflict);
    provider.snapshots.set(
      userId,
      paidSnapshot({ orders: [paidOrder({ totalAmount: -1 })] }),
    );
    await expect(
      service.syncCustomer({ userId, reason: "malformed" }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect((await service.resolveEntitlements(userId)).tier).toBe("plus");
    const [order] = await handle.db.select().from(billingOrders);
    expect(order?.totalAmount).toBe(900);
  });
  it.each([
    new Error("provider timeout"),
    new HttpError(409, "Refund needs review", "refund_conflict"),
  ])("keeps refund revocation retryable after %s", async (error) => {
    const service = services();
    const order = paidOrder({ refundedAmount: 900 });
    provider.snapshots.set(
      userId,
      paidSnapshot({ orders: [order], paidPeriod: order }),
    );
    vi.spyOn(provider, "revokeSubscription").mockRejectedValueOnce(error);
    const failed = service.syncCustomer({ userId, reason: "refund" });
    if (error instanceof HttpError) await expect(failed).rejects.toBe(error);
    else
      await expect(failed).rejects.toMatchObject({
        statusCode: 503,
        code: "billing_unavailable",
      });
    expect((await service.resolveEntitlements(userId)).reason).toBe("revoked");
    expect(
      (await handle.db.select().from(billingSubscriptions))[0]?.revokePending,
    ).toBe(1);

    await service.syncCustomer({ userId, reason: "retry refund" });
    expect(
      (await handle.db.select().from(billingSubscriptions))[0]?.revokePending,
    ).toBe(2);
    expect(provider.revoked).toEqual(["subscription"]);
  });
  it("abandons pending revocation when the final provider check finds a newer payment", async () => {
    const service = services();
    const refunded = paidOrder({ refundedAmount: 900 });
    const renewed = paidOrder({
      orderId: "renewal",
      start: new Date("2026-11-01Z"),
      end: new Date("2026-12-01Z"),
    });
    provider.snapshots.set(
      userId,
      paidSnapshot({ orders: [refunded, renewed] }),
    );
    vi.spyOn(provider, "fetchSnapshot").mockResolvedValueOnce(
      paidSnapshot({ orders: [refunded] }),
    );
    await service.syncCustomer({
      userId,
      reason: "refund overtaken by payment",
    });
    expect(provider.revoked).toEqual([]);
    expect(
      (await handle.db.select().from(billingSubscriptions))[0]?.revokePending,
    ).toBe(0);
    await service.syncCustomer({ userId, reason: "confirm new payment" });
    expect((await service.resolveEntitlements(userId)).tier).toBe("plus");
  });
  it("does not revoke a deleted subscription during the final refund check", async () => {
    const service = services();
    const refunded = paidOrder({ refundedAmount: 900 });
    vi.spyOn(provider, "fetchSnapshot").mockResolvedValueOnce(
      paidSnapshot({ orders: [refunded] }),
    );
    await service.syncCustomer({
      userId,
      reason: "refund after provider deletion",
    });
    expect(provider.revoked).toEqual([]);
    expect(
      (await handle.db.select().from(billingSubscriptions))[0]?.revokePending,
    ).toBe(0);
  });
  it("uses the runtime clock for persisted synchronization timestamps by default", async () => {
    const before = Date.now();
    const { syncCustomer } = createBillingSync({
      db: handle.db,
      providers: { polar: provider },
      config: testConfig(),
    });
    await syncCustomer({ userId, reason: "default clock" });
    const [customer] = await handle.db.select().from(billingCustomers);
    expect(customer?.lastSyncedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(customer?.lastSyncedAt?.getTime()).toBeLessThanOrEqual(Date.now());
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
      enabledProviders: ["polar"],
      db: handle.db,
      syncCustomer: service.syncCustomer,
    });
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 0,
      failed: 1,
    });
    const restarted = createBillingReconciler({
      enabledProviders: ["polar"],
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
      enabledProviders: ["polar"],
      db: handle.db,
      syncCustomer: service.syncCustomer,
    });
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 0,
      failed: 1,
    });
    const restarted = createBillingReconciler({
      enabledProviders: ["polar"],
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
  it("binds a previously unknown webhook customer and processes its payment", async () => {
    const clock = new Date();
    await handle.db
      .insert(billingCustomers)
      .values({ userId, nextSyncAt: clock });
    await handle.db
      .insert(billingProviderCustomers)
      .values({ userId, provider: "polar", customerId: "customer" });
    await handle.db.insert(billingWebhookInbox).values({
      eventId: "unbound-customer",
      eventType: "order.paid",
      customerId: "customer",
      nextSyncAt: clock,
    });
    provider.snapshots.set(userId, paidSnapshot());
    const service = services();
    const reconciler = createBillingReconciler({
      enabledProviders: ["polar"],
      db: handle.db,
      syncCustomer: service.syncCustomer,
      now: () => clock,
    });
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 1,
      failed: 0,
    });
    const [event] = await handle.db.select().from(billingWebhookInbox);
    expect(event?.userId).toBe(userId);
    expect(event?.processedAt).not.toBeNull();
    expect((await service.resolveEntitlements(userId)).tier).toBe("plus");
  });
  it("persists first-sync failure backoff and retries the inbox after the deadline", async () => {
    let clock = new Date();
    await handle.db.insert(billingWebhookInbox).values({
      eventId: "first-payment",
      eventType: "order.paid",
      userId,
      nextSyncAt: clock,
    });
    provider.failFetch = true;
    const service = services();
    const reconciler = createBillingReconciler({
      enabledProviders: ["polar"],
      db: handle.db,
      syncCustomer: service.syncCustomer,
      now: () => clock,
    });
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 0,
      failed: 1,
    });
    const [failedCustomer] = await handle.db.select().from(billingCustomers);
    const [failedEvent] = await handle.db.select().from(billingWebhookInbox);
    expect(failedCustomer).toMatchObject({
      syncFailures: 1,
      lastSyncedAt: null,
      nextSyncAt: new Date(clock.getTime() + 60_000),
    });
    expect(failedEvent).toMatchObject({
      syncFailures: 1,
      processedAt: null,
      nextSyncAt: new Date(clock.getTime() + 60_000),
    });
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 0,
      failed: 0,
    });

    provider.failFetch = false;
    provider.snapshots.set(userId, paidSnapshot());
    clock = new Date(clock.getTime() + 60_000);
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 1,
      failed: 0,
    });
    const [recovered] = await handle.db.select().from(billingCustomers);
    expect(recovered).toMatchObject({
      syncFailures: 0,
      nextSyncAt: new Date(clock.getTime() + 300_000),
    });
    expect(
      (await handle.db.select().from(billingWebhookInbox))[0]?.processedAt,
    ).not.toBeNull();
    expect((await service.resolveEntitlements(userId)).tier).toBe("plus");
  });
  it("rejects invalid reconciliation batch sizes before processing customers", async () => {
    const reconciler = createBillingReconciler({
      enabledProviders: ["polar"],
      db: handle.db,
      syncCustomer: services().syncCustomer,
    });
    for (const limit of [0, -1, 1.5, 1001])
      await expect(reconciler.reconcileBilling({ limit })).rejects.toThrow(
        "Reconciliation limit must be 1..1000",
      );
    expect(await handle.db.select().from(billingCustomers)).toEqual([]);
  });
  it("keeps overlapping reconciliation runs from processing the same customer", async () => {
    await handle.db.insert(billingCustomers).values({ userId });
    const service = services();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncCustomer = vi.fn(
      async (input: Parameters<typeof service.syncCustomer>[0]) => {
        await blocked;
        await service.syncCustomer(input);
      },
    );
    const reconciler = createBillingReconciler({
      enabledProviders: ["polar"],
      db: handle.db,
      syncCustomer,
    });
    const first = reconciler.reconcileBilling({ limit: 1 });
    await vi.waitFor(() => expect(syncCustomer).toHaveBeenCalledTimes(1));
    expect(await reconciler.reconcileBilling({ limit: 1 })).toEqual({
      processed: 0,
      failed: 0,
    });
    release?.();
    expect(await first).toEqual({ processed: 1, failed: 0 });
    expect(
      (await handle.db.select().from(billingCustomers))[0]?.lastSyncedAt,
    ).not.toBeNull();
  });
  it("runs scheduled reconciliation, reports database failures, and stops its timer", async () => {
    await handle.db.insert(billingCustomers).values({ userId });
    const reconciler = createBillingReconciler({
      enabledProviders: ["polar"],
      db: handle.db,
      syncCustomer: services().syncCustomer,
    });
    vi.useFakeTimers();
    const onResult = vi.fn();
    const stop = reconciler.start({ onResult, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ processed: 1, failed: 0 }),
    );
    expect(
      (await handle.db.select().from(billingCustomers))[0]?.lastSyncedAt,
    ).not.toBeNull();

    vi.spyOn(handle.db, "select").mockImplementationOnce(() => {
      throw new Error("database offline");
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onResult).toHaveBeenLastCalledWith({ processed: 0, failed: 1 });
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onResult).toHaveBeenCalledTimes(2);
  });
});
