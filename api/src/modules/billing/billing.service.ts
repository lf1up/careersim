import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../../db/client.js";
import { billingCheckoutAttempts, billingCustomers } from "../../db/schema.js";
import { HttpError } from "../../plugins/errors.js";
import {
  billingSnapshotSchema,
  type BillingAccount,
  type BillingChoice,
  type BillingUsage,
  type Entitlement,
  type PlanCatalog,
  type PlanLimits,
} from "./billing.schema.js";
import { productForChoice, type BillingConfig } from "./catalog.js";
import type { BillingProvider, ProviderCheckout } from "./polar.js";
import { lockBillingCustomer, type SyncCustomer } from "./sync.js";
import { FAILED_RENEWAL_GRACE_MS } from "./entitlements.js";

const openStatuses = ["creating", "pending", "ambiguous"];
const emptyUsage: BillingUsage = {
  sessions: null,
  chatMessages: null,
  customSimulations: null,
  customPersonas: null,
  voice: null,
};

export function createBillingService({
  db,
  config,
  catalog,
  provider,
  syncCustomer,
  resolveEntitlements,
  now = () => new Date(),
  readUsage,
}: {
  db: AppDatabase;
  config: BillingConfig;
  catalog: PlanCatalog;
  provider: BillingProvider;
  syncCustomer: SyncCustomer;
  resolveEntitlements: (userId: string) => Promise<Entitlement>;
  now?: () => Date;
  readUsage?: (userId: string, limits: PlanLimits) => Promise<BillingUsage>;
}) {
  function conflict(code: string, message: string): HttpError {
    return new HttpError(409, message, code, {
      contactUrl: config.BILLING_CONTACT_URL,
    });
  }
  function requireChoice(choice: BillingChoice): void {
    if (!config.BILLING_ENABLED)
      throw conflict(
        "billing_disabled",
        "New purchases are currently unavailable.",
      );
    if (
      choice.tier === "supporter" &&
      (!config.SUPPORTER_CHECKOUT_ENABLED || !config.SUPPORTER_CHANNEL_URL)
    ) {
      throw conflict(
        "supporter_unavailable",
        "Supporter is not available for purchase.",
      );
    }
    if (!productForChoice(config, choice))
      throw conflict(
        "billing_product_unavailable",
        "This billing choice is unavailable.",
      );
  }
  async function getAccount(userId: string): Promise<BillingAccount> {
    const [row] = await db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, userId));
    const snapshot = billingSnapshotSchema.parse(
      row?.snapshot ?? { kind: "none" },
    );
    const entitlement = await resolveEntitlements(userId);
    const attempts = await db
      .select()
      .from(billingCheckoutAttempts)
      .where(
        and(
          eq(billingCheckoutAttempts.userId, userId),
          inArray(billingCheckoutAttempts.status, openStatuses),
        ),
      );
    const pendingCheckout = attempts.some(
      (attempt) => !attempt.expiresAt || attempt.expiresAt > now(),
    );
    return {
      ...entitlement,
      interval:
        snapshot.kind === "subscription"
          ? (snapshot.choice?.interval ?? null)
          : null,
      accessThrough:
        entitlement.tier !== "free" &&
        snapshot.kind === "subscription" &&
        snapshot.paidPeriod
          ? new Date(
              snapshot.paidPeriod.end.getTime() +
                (snapshot.failedRenewal && !snapshot.cancelAtPeriodEnd
                  ? FAILED_RENEWAL_GRACE_MS
                  : 0),
            ).toISOString()
          : null,
      paidThrough:
        snapshot.kind === "subscription"
          ? (snapshot.paidPeriod?.end.toISOString() ?? null)
          : null,
      status: snapshot.kind === "subscription" ? snapshot.status : "free",
      cancelAtPeriodEnd:
        snapshot.kind === "subscription" && snapshot.cancelAtPeriodEnd,
      renews:
        snapshot.kind === "subscription" &&
        !snapshot.cancelAtPeriodEnd &&
        !snapshot.revoked,
      pendingChange:
        snapshot.kind === "subscription" && snapshot.pendingChange
          ? {
              choice: snapshot.pendingChange.choice,
              effectiveAt: snapshot.pendingChange.effectiveAt.toISOString(),
            }
          : null,
      pendingCheckout,
      confirmationPending: pendingCheckout && entitlement.tier === "free",
      usage: readUsage
        ? await readUsage(userId, entitlement.limits)
        : { ...emptyUsage },
      planChangesAvailable: catalog.planChangesAvailable,
      contactUrl: config.BILLING_CONTACT_URL,
    };
  }
  async function portal(userId: string): Promise<{ url: string }> {
    const [row] = await db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, userId));
    if (!row?.customerId)
      throw conflict(
        "billing_customer_missing",
        "No verified billing customer is available.",
      );
    try {
      return await provider.createPortal(userId);
    } catch {
      throw new HttpError(
        503,
        "Billing management is temporarily unavailable.",
        "billing_unavailable",
      );
    }
  }
  async function startCheckout({
    userId,
    choice,
  }: {
    userId: string;
    choice: BillingChoice;
  }): Promise<{ url: string }> {
    requireChoice(choice);
    // A fresh authoritative read is mandatory before any new subscription intent.
    await syncCustomer({ userId, reason: "checkout" });
    type Action =
      | { kind: "create"; attemptId: string }
      | { kind: "reuse"; url: string }
      | { kind: "manage" }
      | { kind: "conflict"; error: HttpError };
    const action: Action = await db.transaction(async (tx) => {
      await lockBillingCustomer(tx, userId);
      const [customer] = await tx
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.userId, userId));
      const snapshot = billingSnapshotSchema.parse(
        customer?.snapshot ?? { kind: "none" },
      );
      if (
        snapshot.kind === "subscription" &&
        !snapshot.revoked &&
        (Boolean(snapshot.paidPeriod && snapshot.paidPeriod.end > now()) ||
          !["canceled", "incomplete_expired"].includes(snapshot.status))
      )
        return { kind: "manage" };
      const attempts = await tx
        .select()
        .from(billingCheckoutAttempts)
        .where(
          and(
            eq(billingCheckoutAttempts.userId, userId),
            inArray(billingCheckoutAttempts.status, openStatuses),
          ),
        )
        .orderBy(desc(billingCheckoutAttempts.createdAt));
      for (const attempt of attempts) {
        let checkout: ProviderCheckout | null =
          attempt.checkoutId && attempt.url && attempt.expiresAt
            ? {
                id: attempt.checkoutId,
                url: attempt.url,
                expiresAt: attempt.expiresAt,
              }
            : null;
        if (!checkout) {
          // A committed intent survives network failure or process death. Never
          // repeat create blindly when the provider's outcome is unknown.
          try {
            checkout = await provider.findCheckout(attempt.attemptId);
          } catch (error) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(
              503,
              "Checkout confirmation is temporarily unavailable.",
              "billing_unavailable",
            );
          }
          if (!checkout)
            return {
              kind: "conflict",
              error: conflict(
                "billing_checkout_pending",
                "A checkout is awaiting confirmation. Refresh or contact support before retrying.",
              ),
            };
          await tx
            .update(billingCheckoutAttempts)
            .set({
              checkoutId: checkout.id,
              url: checkout.url,
              expiresAt: checkout.expiresAt,
              status: "pending",
            })
            .where(eq(billingCheckoutAttempts.attemptId, attempt.attemptId));
        }
        if (checkout.expiresAt <= now()) {
          await tx
            .update(billingCheckoutAttempts)
            .set({ status: "expired" })
            .where(eq(billingCheckoutAttempts.attemptId, attempt.attemptId));
          continue;
        }
        if (
          attempt.tier !== choice.tier ||
          attempt.interval !== choice.interval
        )
          return {
            kind: "conflict",
            error: conflict(
              "billing_checkout_conflict",
              "Finish or wait for the existing checkout before choosing another plan.",
            ),
          };
        return { kind: "reuse", url: checkout.url };
      }
      const attemptId = randomUUID();
      await tx.insert(billingCheckoutAttempts).values({
        attemptId,
        userId,
        tier: choice.tier,
        interval: choice.interval,
        status: "creating",
        createdAt: now(),
      });
      return { kind: "create", attemptId };
    });
    if (action.kind === "manage") return portal(userId);
    if (action.kind === "reuse") return { url: action.url };
    if (action.kind === "conflict") throw action.error;
    let checkout: ProviderCheckout;
    try {
      checkout = await provider.createCheckout({
        userId,
        choice,
        attemptId: action.attemptId,
      });
    } catch {
      await db
        .update(billingCheckoutAttempts)
        .set({ status: "ambiguous" })
        .where(
          and(
            eq(billingCheckoutAttempts.attemptId, action.attemptId),
            eq(billingCheckoutAttempts.status, "creating"),
          ),
        );
      throw new HttpError(
        503,
        "Checkout confirmation is pending. Refresh before retrying.",
        "billing_checkout_pending",
      );
    }
    await db
      .update(billingCheckoutAttempts)
      .set({
        status: "pending",
        checkoutId: checkout.id,
        url: checkout.url,
        expiresAt: checkout.expiresAt,
      })
      .where(
        and(
          eq(billingCheckoutAttempts.attemptId, action.attemptId),
          inArray(billingCheckoutAttempts.status, openStatuses),
        ),
      );
    return { url: checkout.url };
  }
  async function refresh(userId: string): Promise<BillingAccount> {
    let confirmationFailed = false;
    try {
      await syncCustomer({ userId, reason: "refresh" });
    } catch (error) {
      if (!(error instanceof HttpError) || error.statusCode !== 503)
        throw error;
      confirmationFailed = true;
    }
    const account = await getAccount(userId);
    return {
      ...account,
      confirmationPending: account.confirmationPending || confirmationFailed,
    };
  }
  async function scheduleChange({
    choice,
  }: {
    userId: string;
    choice: BillingChoice;
  }): Promise<{ choice: BillingChoice; effectiveAt: string }> {
    requireChoice(choice);
    // No combination is enabled before actual sandbox evidence. The portal
    // organization settings must independently prohibit unverified switches.
    throw conflict(
      "billing_change_unavailable",
      "Plan changes are not available yet. Contact us to discuss a next-period change.",
    );
  }
  async function supporterAccess(
    userId: string,
  ): Promise<{ channelUrl: string; instructions: string }> {
    const entitlement = await resolveEntitlements(userId);
    if (!entitlement.supporterAccess || !config.SUPPORTER_CHANNEL_URL)
      throw new HttpError(
        403,
        "Verified Supporter access is required.",
        "supporter_access_required",
      );
    return {
      channelUrl: config.SUPPORTER_CHANNEL_URL,
      instructions:
        "Contact the development team through the private channel to verify your membership. Membership is checked against your current CareerSim Supporter access.",
    };
  }
  return {
    getAccount,
    startCheckout,
    refresh,
    portal,
    scheduleChange,
    supporterAccess,
  };
}
