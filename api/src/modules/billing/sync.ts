import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../../db/client.js";
import {
  billingCustomers,
  billingProviderCustomers,
  billingSubscriptions,
  billingOrders,
  billingWebhookInbox,
  billingCheckoutAttempts,
} from "../../db/schema.js";
import {
  billingChoiceSchema,
  billingSnapshotSchema,
  type BillingSnapshot,
  type PaidOrder,
} from "./billing.schema.js";
import { choiceForProduct, type BillingConfig } from "./catalog.js";
import {
  type BillingProviders,
  type ProviderReferences,
  requireProvider,
} from "./provider.js";
import { providerEnabled, type BillingProviderId } from "./routing.js";
import { subscriptionObligation } from "./entitlements.js";
import { HttpError } from "../../plugins/errors.js";

export type SyncCustomer = (input: {
  userId: string;
  reason: string;
  provider?: BillingProviderId;
  reconcileAt?: Date;
}) => Promise<void>;
export type BillingTransaction = Parameters<
  Parameters<AppDatabase["transaction"]>[0]
>[0];
export async function lockBillingCustomer(
  tx: BillingTransaction,
  userId: string,
): Promise<void> {
  await tx.insert(billingCustomers).values({ userId }).onConflictDoNothing();
  await tx
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, userId))
    .for("update");
}
export async function providerReferences(
  tx: BillingTransaction | AppDatabase,
  userId: string,
  provider: BillingProviderId,
): Promise<ProviderReferences> {
  const [customer] = await tx
    .select()
    .from(billingProviderCustomers)
    .where(
      and(
        eq(billingProviderCustomers.userId, userId),
        eq(billingProviderCustomers.provider, provider),
      ),
    );
  const subscriptions = await tx
    .select()
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.userId, userId),
        eq(billingSubscriptions.provider, provider),
      ),
    );
  const attempts = await tx
    .select()
    .from(billingCheckoutAttempts)
    .where(
      and(
        eq(billingCheckoutAttempts.userId, userId),
        eq(billingCheckoutAttempts.provider, provider),
        inArray(billingCheckoutAttempts.status, [
          "creating",
          "pending",
          "ambiguous",
        ]),
      ),
    );
  const orders = await tx
    .select()
    .from(billingOrders)
    .innerJoin(
      billingSubscriptions,
      and(
        eq(billingOrders.provider, billingSubscriptions.provider),
        eq(billingOrders.subscriptionId, billingSubscriptions.subscriptionId),
      ),
    )
    .where(
      and(
        eq(billingSubscriptions.userId, userId),
        eq(billingOrders.provider, provider),
      ),
    );
  return {
    orders: orders.map(({ billing_orders: row }) => ({
      orderId: row.orderId,
      checkoutId: row.checkoutId,
      productId: row.productId,
      subscriptionId: row.subscriptionId,
      start: row.periodStart,
      end: row.periodEnd,
    })),
    customerId: customer?.customerId ?? null,
    subscriptionIds: subscriptions.map((row) => row.subscriptionId),
    checkouts: attempts.map((row) => ({
      attemptId: row.attemptId,
      checkoutId: row.checkoutId,
      choice: billingChoiceSchema.parse({
        tier: row.tier,
        interval: row.interval,
      }),
    })),
  };
}
function mergeRefundedAmount(
  incoming: number | null,
  previous?: number | null,
): number | null {
  // Unknown evidence must not invent zero or erase a verified refund.
  return incoming === null
    ? previous || null
    : Math.max(incoming, previous ?? 0);
}
function mergeDispute(
  incoming: PaidOrder,
  previous?: typeof billingOrders.$inferSelect,
): PaidOrder {
  const dispute =
    incoming.dispute === "none" &&
    (previous?.dispute === "open" || previous?.dispute === "lost")
      ? previous.dispute
      : incoming.dispute;
  return {
    ...incoming,
    dispute,
    refundedAmount: mergeRefundedAmount(
      incoming.refundedAmount,
      previous?.refundedAmount,
    ),
  };
}
function restrictDuringConflict(
  frozen: BillingSnapshot,
  fresh?: BillingSnapshot,
): BillingSnapshot {
  if (
    frozen.kind !== "subscription" ||
    fresh?.kind !== "subscription" ||
    frozen.subscriptionId !== fresh.subscriptionId
  )
    return frozen;
  const restrictOrder = (order: PaidOrder): PaidOrder => {
    const evidence = fresh.orders.find(
      (item) => item.orderId === order.orderId,
    );
    if (!evidence) return order;
    return {
      ...order,
      refundedAmount: mergeRefundedAmount(
        evidence.refundedAmount,
        order.refundedAmount,
      ),
      dispute:
        order.dispute === "open" || order.dispute === "lost"
          ? order.dispute
          : evidence.dispute,
    };
  };
  return {
    ...frozen,
    revoked: frozen.revoked || fresh.revoked,
    cancelAtPeriodEnd: frozen.cancelAtPeriodEnd || fresh.cancelAtPeriodEnd,
    paidPeriod: frozen.paidPeriod ? restrictOrder(frozen.paidPeriod) : null,
    orders: frozen.orders.map(restrictOrder),
  };
}
export function createBillingSync({
  db,
  providers,
  config,
  now = () => new Date(),
}: {
  db: AppDatabase;
  providers: BillingProviders;
  config: BillingConfig;
  now?: () => Date;
}): { syncCustomer: SyncCustomer } {
  async function fetchSnapshot(
    tx: BillingTransaction,
    userId: string,
    provider: BillingProviderId,
  ): Promise<BillingSnapshot> {
    try {
      return billingSnapshotSchema.parse(
        await requireProvider(providers, provider).fetchSnapshot(
          userId,
          await providerReferences(tx, userId, provider),
        ),
      );
    } catch (error) {
      if (
        error instanceof HttpError ||
        (error instanceof Error && error.name === "ZodError")
      )
        throw error;
      throw new HttpError(
        503,
        "Billing provider is temporarily unavailable.",
        "billing_unavailable",
      );
    }
  }
  const syncCustomer: SyncCustomer = async ({
    userId,
    provider: requestedProvider,
    reason,
    reconcileAt,
  }) => {
    const scheduleNow = reconcileAt ?? now();
    let unavailable = false;
    const conflictingProviders = new Set<BillingProviderId>();
    await db.transaction(async (tx) => {
      await lockBillingCustomer(tx, userId);
      const [account] = await tx
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.userId, userId));
      const stored = await tx
        .select()
        .from(billingProviderCustomers)
        .where(eq(billingProviderCustomers.userId, userId));
      for (const row of stored)
        if (row.billingConflict) conflictingProviders.add(row.provider);
      const attempts = await tx
        .select()
        .from(billingCheckoutAttempts)
        .where(eq(billingCheckoutAttempts.userId, userId));
      const deliveries = await tx
        .select()
        .from(billingWebhookInbox)
        .where(
          and(
            eq(billingWebhookInbox.userId, userId),
            isNull(billingWebhookInbox.processedAt),
          ),
        );
      const snapshots = new Map<BillingProviderId, BillingSnapshot>(
        stored.map((row) => [
          row.provider,
          billingSnapshotSchema.parse(row.snapshot ?? { kind: "none" }),
        ]),
      );
      const relevant = new Set<BillingProviderId>([
        ...(requestedProvider ? [requestedProvider] : []),
        ...(providers[config.BILLING_DEFAULT_PROVIDER]
          ? [config.BILLING_DEFAULT_PROVIDER]
          : []),
        ...stored.map((row) => row.provider),
        ...attempts.map((row) => row.provider),
        ...deliveries.map((row) => row.provider),
      ]);
      for (const provider of relevant) {
        if (!providerEnabled(config, provider)) continue;
        if (
          reason === "portal" &&
          requestedProvider &&
          provider !== requestedProvider
        )
          continue;
        const previousCustomer = stored.find(
          (row) => row.provider === provider,
        );
        if (
          reason === "reconciliation" &&
          previousCustomer &&
          previousCustomer.nextSyncAt > scheduleNow &&
          !deliveries.some(
            (row) => row.provider === provider && row.nextSyncAt <= scheduleNow,
          )
        )
          continue;
        let snapshot: BillingSnapshot;
        try {
          snapshot = await fetchSnapshot(tx, userId, provider);
        } catch (error) {
          const duplicate =
            error instanceof HttpError &&
            error.statusCode === 409 &&
            error.code === "billing_duplicate_subscriptions";
          // A provider conflict must not roll back another provider's restrictions.
          if (
            !duplicate &&
            (!(error instanceof HttpError) ||
              ![502, 503, 504].includes(error.statusCode))
          )
            throw error;
          if (duplicate) conflictingProviders.add(provider);
          const failures = (previousCustomer?.syncFailures ?? 0) + 1;
          const nextSyncAt = new Date(
            scheduleNow.getTime() +
              Math.min(3_600_000, 60_000 * 2 ** Math.min(failures - 1, 6)),
          );
          await tx
            .insert(billingProviderCustomers)
            .values({
              userId,
              provider,
              syncFailures: failures,
              nextSyncAt,
              billingConflict: conflictingProviders.has(provider) ? 1 : 0,
            })
            .onConflictDoUpdate({
              target: [
                billingProviderCustomers.userId,
                billingProviderCustomers.provider,
              ],
              set: {
                syncFailures: failures,
                nextSyncAt,
                billingConflict: conflictingProviders.has(provider) ? 1 : 0,
              },
            });
          unavailable ||= !duplicate;
          continue;
        }
        if (snapshot.kind === "subscription") {
          const subscriptionId = snapshot.subscriptionId;
          const [previousSubscription] = await tx
            .select()
            .from(billingSubscriptions)
            .where(
              and(
                eq(billingSubscriptions.provider, provider),
                eq(billingSubscriptions.subscriptionId, subscriptionId),
              ),
            );
          if (previousSubscription && previousSubscription.userId !== userId)
            throw new Error("Provider subscription identity mismatch");
          const existing = await tx
            .select()
            .from(billingOrders)
            .where(
              and(
                eq(billingOrders.provider, provider),
                eq(billingOrders.subscriptionId, subscriptionId),
              ),
            );
          const previousById = new Map(
            existing.map((order) => [order.orderId, order]),
          );
          const orders = snapshot.orders.map((order) =>
            mergeDispute(order, previousById.get(order.orderId)),
          );
          for (const previous of existing)
            if (!orders.some((order) => order.orderId === previous.orderId))
              orders.push({
                orderId: previous.orderId,
                checkoutId: previous.checkoutId,
                productId: previous.productId,
                start: previous.periodStart,
                end: previous.periodEnd,
                totalAmount: previous.totalAmount,
                refundedAmount: previous.refundedAmount,
                dispute:
                  previous.dispute === "open" ||
                  previous.dispute === "lost" ||
                  previous.dispute === "won"
                    ? previous.dispute
                    : "none",
              });
          for (const delivery of deliveries.filter(
            (row) => row.provider === provider && row.dispute && row.orderId,
          )) {
            const order = orders.find(
              (item) => item.orderId === delivery.orderId,
            );
            if (
              order &&
              (delivery.dispute === "open" || delivery.dispute === "lost")
            )
              order.dispute = delivery.dispute;
          }
          const paidPeriod =
            orders
              .filter((order) => order.start <= now())
              .sort(
                (a, b) =>
                  b.start.getTime() - a.start.getTime() ||
                  b.end.getTime() - a.end.getTime(),
              )[0] ?? null;
          snapshot = {
            ...snapshot,
            orders,
            paidPeriod,
            choice: paidPeriod
              ? choiceForProduct(config, paidPeriod.productId, provider)
              : null,
          };
          if (snapshot.billingCountry) {
            const checkout = attempts
              .filter(
                (attempt) =>
                  attempt.provider === provider &&
                  orders.some(
                    (order) => order.checkoutId === attempt.checkoutId,
                  ),
              )
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
            snapshot = {
              ...snapshot,
              billingCountryMismatch: Boolean(
                checkout?.billingCountry &&
                checkout.billingCountry !== snapshot.billingCountry,
              ),
            };
          }
          const fullRefund = Boolean(
            paidPeriod &&
            snapshot.choice &&
            paidPeriod.totalAmount > 0 &&
            paidPeriod.refundedAmount !== null &&
            paidPeriod.refundedAmount >= paidPeriod.totalAmount,
          );
          await tx
            .insert(billingSubscriptions)
            .values({
              provider,
              subscriptionId,
              userId,
              productId: snapshot.productId,
              status: snapshot.status,
              paidThrough: paidPeriod?.end,
              revokePending: fullRefund ? 1 : 0,
              lastSyncedAt: now(),
            })
            .onConflictDoUpdate({
              target: [
                billingSubscriptions.provider,
                billingSubscriptions.subscriptionId,
              ],
              set: {
                productId: snapshot.productId,
                status: snapshot.status,
                paidThrough: paidPeriod?.end ?? null,
                revokePending:
                  fullRefund && previousSubscription?.revokePending !== 2
                    ? 1
                    : previousSubscription?.revokePending === 2
                      ? 2
                      : 0,
                lastSyncedAt: now(),
              },
            });
          for (const order of orders) {
            const [owned] = await tx
              .select()
              .from(billingOrders)
              .where(
                and(
                  eq(billingOrders.provider, provider),
                  eq(billingOrders.orderId, order.orderId),
                ),
              );
            if (owned && owned.subscriptionId !== subscriptionId)
              throw new Error("Provider order identity mismatch");
            await tx
              .insert(billingOrders)
              .values({
                provider,
                orderId: order.orderId,
                checkoutId: order.checkoutId,
                subscriptionId,
                productId: order.productId,
                periodStart: order.start,
                periodEnd: order.end,
                totalAmount: order.totalAmount,
                refundedAmount: order.refundedAmount,
                dispute: order.dispute,
              })
              .onConflictDoUpdate({
                target: [billingOrders.provider, billingOrders.orderId],
                set: {
                  refundedAmount: order.refundedAmount,
                  dispute: order.dispute,
                  ...(order.checkoutId ? { checkoutId: order.checkoutId } : {}),
                },
              });
          }
          await tx
            .update(billingWebhookInbox)
            .set({ userId })
            .where(
              and(
                eq(billingWebhookInbox.provider, provider),
                eq(billingWebhookInbox.customerId, snapshot.customerId),
                isNull(billingWebhookInbox.userId),
              ),
            );
          const paidCheckoutIds = orders.flatMap((order) =>
            order.checkoutId ? [order.checkoutId] : [],
          );
          if (paidCheckoutIds.length)
            await tx
              .update(billingCheckoutAttempts)
              .set({ status: "completed" })
              .where(
                and(
                  eq(billingCheckoutAttempts.provider, provider),
                  eq(billingCheckoutAttempts.userId, userId),
                  inArray(billingCheckoutAttempts.checkoutId, paidCheckoutIds),
                  inArray(billingCheckoutAttempts.status, [
                    "creating",
                    "pending",
                    "ambiguous",
                  ]),
                ),
              );
        }
        conflictingProviders.delete(provider);
        snapshots.set(provider, snapshot);
        await tx
          .insert(billingProviderCustomers)
          .values({
            userId,
            provider,
            customerId:
              snapshot.kind === "subscription" ? snapshot.customerId : null,
            snapshot,
            lastSyncedAt: now(),
            nextSyncAt: new Date(scheduleNow.getTime() + 300_000),
            syncFailures: 0,
            billingConflict: 0,
          })
          .onConflictDoUpdate({
            target: [
              billingProviderCustomers.userId,
              billingProviderCustomers.provider,
            ],
            set: {
              nextSyncAt: new Date(scheduleNow.getTime() + 300_000),
              syncFailures: 0,
              billingConflict: 0,
              ...(snapshot.kind === "subscription"
                ? { customerId: snapshot.customerId }
                : {}),
              snapshot,
              lastSyncedAt: now(),
            },
          });
        const delivered = deliveries
          .filter(
            (row) =>
              row.provider === provider &&
              (!row.dispute ||
                Boolean(
                  row.orderId &&
                  snapshot.kind === "subscription" &&
                  snapshot.orders.some(
                    (order) => order.orderId === row.orderId,
                  ),
                )),
          )
          .map((row) => row.eventId);
        if (delivered.length)
          await tx
            .update(billingWebhookInbox)
            .set({ processedAt: now() })
            .where(
              and(
                eq(billingWebhookInbox.provider, provider),
                inArray(billingWebhookInbox.eventId, delivered),
              ),
            );
      }
      const obligations = [...snapshots].filter(([, snapshot]) =>
        subscriptionObligation(snapshot, now()),
      );
      const conflict = conflictingProviders.size > 0 || obligations.length > 1;
      const fallback = [...snapshots].sort(
        (a, b) =>
          (b[1].kind === "subscription"
            ? (b[1].paidPeriod?.end.getTime() ?? 0)
            : 0) -
          (a[1].kind === "subscription"
            ? (a[1].paidPeriod?.end.getTime() ?? 0)
            : 0),
      )[0];
      const selected = conflict
        ? account?.snapshot?.kind === "subscription" &&
          account.provider &&
          snapshots.has(account.provider)
          ? ([
              account.provider,
              restrictDuringConflict(
                billingSnapshotSchema.parse(account.snapshot),
                snapshots.get(account.provider),
              ),
            ] as const)
          : null
        : (obligations[0] ?? fallback);
      await tx
        .update(billingCustomers)
        .set({
          billingConflict: conflict ? 1 : 0,
          ...(selected ? { provider: selected[0], snapshot: selected[1] } : {}),
          lastSyncedAt: unavailable ? account?.lastSyncedAt : now(),
        })
        .where(eq(billingCustomers.userId, userId));
    });
    // Persist access changes and cancellation intent before mutating the provider.
    await db.transaction(async (tx) => {
      await lockBillingCustomer(tx, userId);
      const pending = await tx
        .select()
        .from(billingSubscriptions)
        .where(
          and(
            eq(billingSubscriptions.userId, userId),
            eq(billingSubscriptions.revokePending, 1),
          ),
        );
      for (const subscription of pending) {
        const provider = subscription.provider;
        if (
          !providerEnabled(config, provider) ||
          conflictingProviders.has(provider) ||
          (reason === "portal" &&
            requestedProvider &&
            provider !== requestedProvider)
        )
          continue;
        const fresh = await fetchSnapshot(tx, userId, provider);
        const latest =
          fresh.kind === "subscription"
            ? fresh.orders
                .filter((order) => order.start <= now())
                .sort((a, b) => b.start.getTime() - a.start.getTime())[0]
            : null;
        const stillRefunded = Boolean(
          fresh.kind === "subscription" &&
          fresh.subscriptionId === subscription.subscriptionId &&
          latest &&
          choiceForProduct(config, latest.productId, provider) &&
          latest.totalAmount > 0 &&
          latest.refundedAmount !== null &&
          latest.refundedAmount >= latest.totalAmount,
        );
        if (stillRefunded) {
          try {
            await requireProvider(providers, provider).revokeSubscription(
              subscription.subscriptionId,
            );
          } catch (error) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(
              503,
              "Billing provider is temporarily unavailable.",
              "billing_unavailable",
            );
          }
        }
        await tx
          .update(billingSubscriptions)
          .set({ revokePending: stillRefunded ? 2 : 0 })
          .where(
            and(
              eq(billingSubscriptions.provider, provider),
              eq(
                billingSubscriptions.subscriptionId,
                subscription.subscriptionId,
              ),
            ),
          );
      }
    });
    if (unavailable)
      throw new HttpError(
        503,
        "Billing confirmation is temporarily unavailable.",
        "billing_unavailable",
      );
  };
  return { syncCustomer };
}
