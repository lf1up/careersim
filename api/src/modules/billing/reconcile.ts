import { and, eq, inArray, isNull, isNotNull, lte, or, sql } from "drizzle-orm";
import type { AppDatabase } from "../../db/client.js";
import {
  billingCustomers,
  billingProviderCustomers,
  billingWebhookInbox,
} from "../../db/schema.js";
import type { BillingProviderId } from "./routing.js";
import type { SyncCustomer } from "./sync.js";

const REFRESH_INTERVAL_MS = 300_000;
function retryAt(now: Date, failures: number): Date {
  return new Date(
    now.getTime() + Math.min(3_600_000, 60_000 * 2 ** Math.min(failures, 6)),
  );
}

export function createBillingReconciler({
  db,
  syncCustomer,
  now = () => new Date(),
  enabledProviders,
}: {
  db: AppDatabase;
  enabledProviders: BillingProviderId[];
  syncCustomer: SyncCustomer;
  now?: () => Date;
}) {
  let running = false;
  async function reconcileBilling({
    limit,
  }: {
    limit: number;
  }): Promise<{ processed: number; failed: number }> {
    if (!enabledProviders.length) return { processed: 0, failed: 0 };
    if (running) return { processed: 0, failed: 0 };
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Reconciliation limit must be 1..1000");
    running = true;
    let processed = 0;
    let failed = 0;
    try {
      const dueAt = now();
      const pending = await db
        .select()
        .from(billingWebhookInbox)
        .where(
          and(
            inArray(billingWebhookInbox.provider, enabledProviders),
            isNull(billingWebhookInbox.processedAt),
            lte(billingWebhookInbox.nextSyncAt, dueAt),
          ),
        )
        .orderBy(billingWebhookInbox.nextSyncAt, billingWebhookInbox.receivedAt)
        .limit(limit);
      // Unbound deliveries also back off, so one missing customer cannot hide
      // newer events at the head of every bounded batch.
      for (const event of pending) {
        if (!event.userId && event.customerId) {
          const [customer] = await db
            .select()
            .from(billingProviderCustomers)
            .where(
              and(
                eq(billingProviderCustomers.provider, event.provider),
                eq(billingProviderCustomers.customerId, event.customerId),
              ),
            );
          if (customer) {
            event.userId = customer.userId;
            await db
              .update(billingWebhookInbox)
              .set({ userId: customer.userId })
              .where(
                and(
                  eq(billingWebhookInbox.provider, event.provider),
                  eq(billingWebhookInbox.eventId, event.eventId),
                ),
              );
          }
        }
        if (!event.userId) {
          await db
            .update(billingWebhookInbox)
            .set({
              syncFailures: event.syncFailures + 1,
              nextSyncAt: retryAt(dueAt, event.syncFailures),
            })
            .where(
              and(
                eq(billingWebhookInbox.provider, event.provider),
                eq(billingWebhookInbox.eventId, event.eventId),
              ),
            );
          failed++;
        }
      }
      const users = new Set(
        pending.flatMap((row) => (row.userId ? [row.userId] : [])),
      );
      const dueProviders = await db
        .select({ userId: billingProviderCustomers.userId })
        .from(billingProviderCustomers)
        .where(
          and(
            inArray(billingProviderCustomers.provider, enabledProviders),
            lte(billingProviderCustomers.nextSyncAt, dueAt),
          ),
        )
        .orderBy(billingProviderCustomers.nextSyncAt)
        .limit(limit);
      for (const customer of dueProviders)
        if (users.size < limit) users.add(customer.userId);
      const customers = await db
        .select({ userId: billingCustomers.userId })
        .from(billingCustomers)
        .where(lte(billingCustomers.nextSyncAt, dueAt))
        .orderBy(billingCustomers.nextSyncAt, billingCustomers.createdAt)
        .limit(limit);
      for (const customer of customers)
        if (users.size < limit) users.add(customer.userId);
      for (const userId of users) {
        try {
          await syncCustomer({
            userId,
            reason: "reconciliation",
            reconcileAt: dueAt,
          });
        } catch {
          const [customer] = await db
            .select()
            .from(billingCustomers)
            .where(eq(billingCustomers.userId, userId));
          const failures = customer?.syncFailures ?? 0;
          const nextSyncAt = retryAt(dueAt, failures);
          // The first sync may have rolled back customer creation. Persist its
          // retry schedule separately so repeated failures still move forward.
          await db
            .insert(billingCustomers)
            .values({ userId, syncFailures: failures + 1, nextSyncAt })
            .onConflictDoUpdate({
              target: billingCustomers.userId,
              set: {
                syncFailures: sql`${billingCustomers.syncFailures} + 1`,
                nextSyncAt,
              },
            });
          // Rolled-back syncs leave provider rows due. Defer them too, without
          // replacing retry deadlines already committed by individual providers.
          await db
            .update(billingProviderCustomers)
            .set({
              syncFailures: sql`${billingProviderCustomers.syncFailures} + 1`,
              nextSyncAt,
            })
            .where(
              and(
                eq(billingProviderCustomers.userId, userId),
                inArray(billingProviderCustomers.provider, enabledProviders),
                lte(billingProviderCustomers.nextSyncAt, dueAt),
              ),
            );
          await db
            .update(billingWebhookInbox)
            .set({
              syncFailures: sql`${billingWebhookInbox.syncFailures} + 1`,
              nextSyncAt,
            })
            .where(
              and(
                eq(billingWebhookInbox.userId, userId),
                inArray(billingWebhookInbox.provider, enabledProviders),
                isNull(billingWebhookInbox.processedAt),
              ),
            );
          failed++;
          continue;
        }
        // Keep scheduling writes outside the provider catch. A database outage
        // must fail the batch rather than masquerade as an upstream timeout.
        await db
          .update(billingCustomers)
          .set({
            syncFailures: 0,
            nextSyncAt: new Date(dueAt.getTime() + REFRESH_INTERVAL_MS),
          })
          .where(eq(billingCustomers.userId, userId));
        const delivered = pending.filter((event) => event.userId === userId);
        if (delivered.length) {
          const keys = or(
            ...delivered.map((event) =>
              and(
                eq(billingWebhookInbox.provider, event.provider),
                eq(billingWebhookInbox.eventId, event.eventId),
              ),
            ),
          );
          await db
            .update(billingWebhookInbox)
            .set({ syncFailures: 0 })
            .where(and(keys, isNotNull(billingWebhookInbox.processedAt)));
          const unresolved = await db
            .select()
            .from(billingWebhookInbox)
            .where(and(keys, isNull(billingWebhookInbox.processedAt)));
          for (const event of unresolved)
            await db
              .update(billingWebhookInbox)
              .set({
                syncFailures: sql`${billingWebhookInbox.syncFailures} + 1`,
                nextSyncAt: retryAt(dueAt, event.syncFailures),
              })
              .where(
                and(
                  eq(billingWebhookInbox.provider, event.provider),
                  eq(billingWebhookInbox.eventId, event.eventId),
                  isNull(billingWebhookInbox.processedAt),
                ),
              );
        }
        processed++;
      }
      return { processed, failed };
    } finally {
      running = false;
    }
  }
  function start({
    onResult,
    intervalMs = REFRESH_INTERVAL_MS,
  }: {
    onResult?: (result: { processed: number; failed: number }) => void;
    intervalMs?: number;
  } = {}) {
    const timer = setInterval(() => {
      void reconcileBilling({ limit: 100 })
        .then(onResult)
        .catch(() => onResult?.({ processed: 0, failed: 1 }));
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
  return { reconcileBilling, start };
}
