import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../../db/client.js";
import {
  billingCheckoutAttempts,
  billingCustomers,
  billingProviderCustomers,
} from "../../db/schema.js";
import { HttpError } from "../../plugins/errors.js";
import {
  billingSnapshotSchema,
  type BillingAccount,
  type BillingChoice,
  type CheckoutChoice,
  type BillingUsage,
  type Entitlement,
  type PlanCatalog,
  type PlanLimits,
} from "./billing.schema.js";
import { productForChoice, type BillingConfig } from "./catalog.js";
import {
  requireProvider,
  type BillingProviders,
  type ProviderCheckout,
} from "./provider.js";
import {
  selectBillingProvider,
  providerEnabled,
  type BillingProviderId,
} from "./routing.js";
import {
  lockBillingCustomer,
  subscriptionObligation,
  type SyncCustomer,
} from "./sync.js";
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
  productName,
  db,
  config,
  catalog,
  providers,
  syncCustomer,
  resolveEntitlements,
  now = () => new Date(),
  readUsage,
}: {
  productName: string;
  db: AppDatabase;
  config: BillingConfig;
  catalog: PlanCatalog;
  providers: BillingProviders;
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
  function requireChoice(
    choice: BillingChoice,
    provider: BillingProviderId = config.BILLING_DEFAULT_PROVIDER,
  ): void {
    if (!config.BILLING_ENABLED)
      throw conflict(
        "billing_disabled",
        "New purchases are currently unavailable.",
      );
    if (choice.tier === "pro" && !config.PRO_CHANNEL_URL) {
      throw conflict("pro_unavailable", "Pro is not available for purchase.");
    }
    if (!productForChoice(config, choice, provider))
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
      billingConflict: Boolean(row?.billingConflict),
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
    if (!row?.provider || row.snapshot?.kind !== "subscription")
      throw conflict(
        "billing_customer_missing",
        "No verified billing customer is available.",
      );
    try {
      if (!providerEnabled(config, row.provider))
        throw new Error("Provider disabled");
      await syncCustomer({ userId, reason: "portal", provider: row.provider });
      return await requireProvider(providers, row.provider).createPortal(
        userId,
      );
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
    choice: selected,
  }: {
    userId: string;
    choice: CheckoutChoice;
  }): Promise<{ url: string }> {
    const { billingCountry, ...choice } = selected;
    if (billingCountry) {
      const [existing] = await db
        .select()
        .from(billingCustomers)
        .where(eq(billingCustomers.userId, userId));
      const confirmedCountry =
        existing?.snapshot?.kind === "subscription"
          ? existing.snapshot.billingCountry
          : null;
      if (confirmedCountry && confirmedCountry !== billingCountry)
        throw conflict(
          "billing_country_mismatch",
          "Update your verified billing country through billing management or contact support before starting checkout.",
        );
    }
    const selectedProvider = selectBillingProvider(config, billingCountry);
    requireChoice(choice, selectedProvider);
    // A fresh authoritative read is mandatory before any new subscription intent.
    await syncCustomer({
      userId,
      reason: "checkout",
      provider: selectedProvider,
    });
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
      if (customer?.billingConflict)
        throw conflict(
          "billing_duplicate_subscriptions",
          "Multiple subscriptions require reconciliation. Contact support.",
        );
      const snapshot = billingSnapshotSchema.parse(
        customer?.snapshot ?? { kind: "none" },
      );
      if (subscriptionObligation(snapshot, now())) return { kind: "manage" };
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
        if (
          attempt.checkoutId &&
          attempt.expiresAt &&
          attempt.expiresAt <= now()
        ) {
          await tx
            .update(billingCheckoutAttempts)
            .set({ status: "expired" })
            .where(eq(billingCheckoutAttempts.attemptId, attempt.attemptId));
          continue;
        }
        if (!providerEnabled(config, attempt.provider))
          throw conflict(
            "billing_checkout_pending",
            "An existing checkout requires confirmation from its billing provider. Contact support.",
          );
        const provider = requireProvider(providers, attempt.provider);
        let checkout: ProviderCheckout | null = null;
        if (!checkout) {
          // A committed intent survives network failure or process death. Never
          // repeat create blindly when the provider's outcome is unknown.
          try {
            checkout = await provider.findCheckout(
              attempt.attemptId,
              attempt.checkoutId,
            );
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
        if (
          checkout.state === "closed" ||
          (checkout.expiresAt && checkout.expiresAt <= now())
        ) {
          await tx
            .update(billingCheckoutAttempts)
            .set({ status: "expired" })
            .where(eq(billingCheckoutAttempts.attemptId, attempt.attemptId));
          continue;
        }
        if (checkout.state === "completed")
          throw conflict(
            "billing_checkout_pending",
            "A payment is awaiting confirmation. Refresh billing before retrying.",
          );
        if (!provider.updateCheckout) {
          if (
            attempt.tier !== choice.tier ||
            attempt.interval !== choice.interval
          )
            throw conflict(
              "billing_checkout_conflict",
              "Your existing checkout must be completed or closed before choosing another plan. Contact support if needed.",
            );
          return { kind: "reuse", url: checkout.url };
        }
        // Reapply even the same choice: a prior provider update may have succeeded
        // before its response or our transaction was lost.
        try {
          checkout = await provider.updateCheckout({
            checkoutId: checkout.id,
            choice,
          });
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(
            503,
            "Checkout update is temporarily unavailable. Please retry.",
            "billing_unavailable",
          );
        }
        await tx
          .update(billingCheckoutAttempts)
          .set({
            tier: choice.tier,
            interval: choice.interval,
            url: checkout.url,
            expiresAt: checkout.expiresAt,
          })
          .where(eq(billingCheckoutAttempts.attemptId, attempt.attemptId));
        return { kind: "reuse", url: checkout.url };
      }
      const attemptId = randomUUID();
      await tx.insert(billingCheckoutAttempts).values({
        attemptId,
        provider: selectedProvider,
        billingCountry,
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
      const provider = requireProvider(providers, selectedProvider);
      const [knownCustomer] = await db
        .select()
        .from(billingProviderCustomers)
        .where(
          and(
            eq(billingProviderCustomers.userId, userId),
            eq(billingProviderCustomers.provider, selectedProvider),
          ),
        );
      checkout = await provider.createCheckout({
        ...(knownCustomer?.customerId
          ? { customerId: knownCustomer.customerId }
          : {}),
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
  async function proAccess(
    userId: string,
  ): Promise<{ channelUrl: string; instructions: string }> {
    const entitlement = await resolveEntitlements(userId);
    if (!entitlement.proAccess || !config.PRO_CHANNEL_URL)
      throw new HttpError(
        403,
        "Verified Pro access is required.",
        "pro_access_required",
      );
    return {
      channelUrl: config.PRO_CHANNEL_URL,
      instructions: `Contact the development team through the private channel to verify your membership. Membership is checked against your current ${productName} Pro access.`,
    };
  }
  return {
    getAccount,
    startCheckout,
    refresh,
    portal,
    scheduleChange,
    proAccess,
  };
}
