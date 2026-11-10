import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../../db/client.js";
import {
  billingCustomers,
  billingSubscriptions,
  billingOrders,
  billingWebhookInbox,
  billingCheckoutAttempts,
} from "../../db/schema.js";
import {
  billingSnapshotSchema,
  type BillingSnapshot,
  type PaidOrder,
} from "./billing.schema.js";
import { choiceForProduct, type BillingConfig } from "./catalog.js";
import type { BillingProvider } from "./polar.js";
import { HttpError } from "../../plugins/errors.js";

export type SyncCustomer = (input: {
  userId: string;
  reason: string;
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
function mergeDispute(
  incoming: PaidOrder,
  previous?: typeof billingOrders.$inferSelect,
): PaidOrder {
  // Absence of dispute evidence is not confirmation that a known dispute was won.
  const dispute =
    incoming.dispute === "none" &&
    (previous?.dispute === "open" || previous?.dispute === "lost")
      ? previous.dispute
      : incoming.dispute;
  return {
    ...incoming,
    dispute,
    refundedAmount: Math.max(
      incoming.refundedAmount,
      previous?.refundedAmount ?? 0,
    ),
  };
}
export function createBillingSync({
  db,
  provider,
  config,
  now = () => new Date(),
}: {
  db: AppDatabase;
  provider: BillingProvider;
  config: BillingConfig;
  now?: () => Date;
}): { syncCustomer: SyncCustomer } {
  async function fetchSnapshot(userId: string): Promise<BillingSnapshot> {
    try {
      return billingSnapshotSchema.parse(await provider.fetchSnapshot(userId));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Malformed provider data is a service error, not an outage fallback.
      if (error instanceof Error && error.name === "ZodError") throw error;
      throw new HttpError(
        503,
        "Billing provider is temporarily unavailable.",
        "billing_unavailable",
      );
    }
  }
  const syncCustomer: SyncCustomer = async ({ userId }) => {
    await db.transaction(async (tx) => {
      // Lock before the network read: concurrent fetches cannot overwrite in reverse order.
      await lockBillingCustomer(tx, userId);
      const deliveries = await tx
        .select({ eventId: billingWebhookInbox.eventId })
        .from(billingWebhookInbox)
        .where(
          and(
            eq(billingWebhookInbox.userId, userId),
            isNull(billingWebhookInbox.processedAt),
          ),
        );
      let snapshot: BillingSnapshot = await fetchSnapshot(userId);
      if (snapshot.kind === "subscription") {
        const existing = await tx
          .select()
          .from(billingOrders)
          .where(eq(billingOrders.subscriptionId, snapshot.subscriptionId));
        const previousById = new Map(
          existing.map((order) => [order.orderId, order]),
        );
        const orders = snapshot.orders.map((order) =>
          mergeDispute(order, previousById.get(order.orderId)),
        );
        // Provider pagination can omit old records, so keep verified history. Only
        // a newer paid order can advance access; a subscription cycle cannot.
        for (const previous of existing)
          if (!orders.some((order) => order.orderId === previous.orderId)) {
            orders.push({
              orderId: previous.orderId,
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
          }
        const paidPeriod =
          orders
            .filter((order) => order.start.getTime() <= now().getTime())
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
            ? choiceForProduct(config, paidPeriod.productId)
            : null,
        };
        const fullRefund = Boolean(
          paidPeriod &&
          choiceForProduct(config, paidPeriod.productId) &&
          paidPeriod.totalAmount > 0 &&
          paidPeriod.refundedAmount >= paidPeriod.totalAmount,
        );
        const [previousSubscription] = await tx
          .select()
          .from(billingSubscriptions)
          .where(
            eq(billingSubscriptions.subscriptionId, snapshot.subscriptionId),
          );
        await tx
          .insert(billingSubscriptions)
          .values({
            subscriptionId: snapshot.subscriptionId,
            userId,
            productId: snapshot.productId,
            status: snapshot.status,
            paidThrough: paidPeriod?.end,
            revokePending: fullRefund ? 1 : 0,
            lastSyncedAt: now(),
          })
          .onConflictDoUpdate({
            target: billingSubscriptions.subscriptionId,
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
        for (const order of orders)
          await tx
            .insert(billingOrders)
            .values({
              orderId: order.orderId,
              subscriptionId: snapshot.subscriptionId,
              productId: order.productId,
              periodStart: order.start,
              periodEnd: order.end,
              totalAmount: order.totalAmount,
              refundedAmount: order.refundedAmount,
              dispute: order.dispute,
            })
            .onConflictDoUpdate({
              target: billingOrders.orderId,
              set: {
                refundedAmount: order.refundedAmount,
                dispute: order.dispute,
              },
            });
        await tx
          .update(billingCustomers)
          .set({
            customerId: snapshot.customerId,
            snapshot,
            lastSyncedAt: now(),
          })
          .where(eq(billingCustomers.userId, userId));
        await tx
          .update(billingWebhookInbox)
          .set({ userId })
          .where(
            and(
              eq(billingWebhookInbox.customerId, snapshot.customerId),
              isNull(billingWebhookInbox.userId),
            ),
          );
        if (paidPeriod)
          await tx
            .update(billingCheckoutAttempts)
            .set({ status: "completed" })
            .where(
              and(
                eq(billingCheckoutAttempts.userId, userId),
                inArray(billingCheckoutAttempts.status, [
                  "creating",
                  "pending",
                  "ambiguous",
                ]),
              ),
            );
      } else {
        await tx
          .update(billingCustomers)
          .set({ snapshot, lastSyncedAt: now() })
          .where(eq(billingCustomers.userId, userId));
      }
      if (deliveries.length)
        await tx
          .update(billingWebhookInbox)
          .set({ processedAt: now() })
          .where(
            inArray(
              billingWebhookInbox.eventId,
              deliveries.map((delivery) => delivery.eventId),
            ),
          );
    });
    // Persist the intent before mutating the provider. A crash or timeout leaves
    // retryable work; refund evidence already denies the corresponding access.
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
        // A newer payment can arrive between recording refund work and retrying
        // the mutation. Recheck authoritative orders under the same user lock.
        const fresh = await fetchSnapshot(userId);
        const latest =
          fresh.kind === "subscription"
            ? fresh.orders
                .filter((order) => order.start <= now())
                .sort((a, b) => b.start.getTime() - a.start.getTime())[0]
            : null;
        const stillRefunded =
          fresh.kind === "subscription" &&
          fresh.subscriptionId === subscription.subscriptionId &&
          latest &&
          choiceForProduct(config, latest.productId) &&
          latest.totalAmount > 0 &&
          latest.refundedAmount >= latest.totalAmount;
        if (stillRefunded) {
          try {
            await provider.revokeSubscription(subscription.subscriptionId);
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
            eq(
              billingSubscriptions.subscriptionId,
              subscription.subscriptionId,
            ),
          );
      }
    });
  };
  return { syncCustomer };
}
