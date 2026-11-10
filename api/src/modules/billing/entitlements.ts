import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db/client.js";
import { billingCustomers } from "../../db/schema.js";
import {
  billingSnapshotSchema,
  type BillingSnapshot,
  type Entitlement,
  type PlanCatalog,
} from "./billing.schema.js";
export const FAILED_RENEWAL_GRACE_MS = 72 * 60 * 60 * 1000;
export function deriveEntitlement(
  snapshot: BillingSnapshot,
  catalog: PlanCatalog,
  now: Date,
): Entitlement {
  const free = (reason: Entitlement["reason"]): Entitlement => ({
    tier: "free",
    limits: catalog.plans.find((p) => p.tier === "free")!.limits,
    supporterAccess: false,
    reason,
  });
  if (snapshot.kind === "none" || !snapshot.choice || !snapshot.paidPeriod)
    return free("free");
  const paid = snapshot.paidPeriod;
  if (
    snapshot.revoked ||
    (paid.totalAmount > 0 && paid.refundedAmount >= paid.totalAmount)
  )
    return free("revoked");
  if (paid.dispute === "open" || paid.dispute === "lost")
    return free("disputed");
  if (paid.start.getTime() > now.getTime()) return free("free");
  const paidThrough = paid.end.getTime();
  const active = now.getTime() < paidThrough;
  const grace =
    !snapshot.cancelAtPeriodEnd &&
    snapshot.failedRenewal &&
    now.getTime() < paidThrough + FAILED_RENEWAL_GRACE_MS;
  if (!active && !grace) return free("expired");
  const tier = snapshot.choice.tier;
  return {
    tier,
    limits: catalog.plans.find((p) => p.tier === tier)!.limits,
    supporterAccess: tier === "supporter",
    reason: active ? "paid" : "grace",
  };
}
export function createEntitlementService({
  db,
  catalog,
  now = () => new Date(),
}: {
  db: AppDatabase;
  catalog: PlanCatalog;
  now?: () => Date;
}) {
  return {
    async resolveEntitlements(userId: string): Promise<Entitlement> {
      const [row] = await db
        .select({ snapshot: billingCustomers.snapshot })
        .from(billingCustomers)
        .where(eq(billingCustomers.userId, userId));
      return deriveEntitlement(
        row?.snapshot
          ? billingSnapshotSchema.parse(row.snapshot)
          : { kind: "none" },
        catalog,
        now(),
      );
    },
  };
}
