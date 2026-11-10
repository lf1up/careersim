// This import deliberately pins the API contract, independently of npm releases.
import { PolarClientError } from "@polar-sh/sdk";
import { createPolar, type models } from "@polar-sh/sdk/2026-10";
import type {
  BillingChoice,
  BillingSnapshot,
  PaidOrder,
} from "./billing.schema.js";
import {
  choiceForProduct,
  productForChoice,
  type BillingConfig,
} from "./catalog.js";
import { HttpError } from "../../plugins/errors.js";

export interface BillingProvider {
  fetchSnapshot(userId: string): Promise<BillingSnapshot>;
  createCheckout(input: {
    userId: string;
    choice: BillingChoice;
    attemptId: string;
  }): Promise<{ id: string; url: string; expiresAt: Date }>;
  findCheckout(attemptId: string): Promise<ProviderCheckout | null>;
  createPortal(userId: string): Promise<{ url: string }>;
  scheduleChange(input: {
    subscriptionId: string;
    choice: BillingChoice;
  }): Promise<void>;
  revokeSubscription(subscriptionId: string): Promise<void>;
}
export type ProviderCheckout = Awaited<
  ReturnType<BillingProvider["createCheckout"]>
>;

/** Keep SDK DTOs inside this boundary. In particular subscription status is not payment proof. */
export function createPolarProvider(config: BillingConfig): BillingProvider {
  const polar = createPolar({
    accessToken: config.POLAR_ACCESS_TOKEN,
    environment: config.POLAR_ENVIRONMENT,
    timeout: 15,
  });
  const returnUrl = new URL(
    "/profile?billing=return",
    config.WEB_APP_URL,
  ).toString();
  function checkoutResult(checkout: models.Checkout): ProviderCheckout {
    return {
      id: checkout.id,
      url: checkout.url,
      expiresAt: new Date(checkout.expires_at),
    };
  }
  async function normalizeOrder(
    order: models.Order,
  ): Promise<PaidOrder | null> {
    if (
      !order.paid ||
      !order.product_id ||
      order.total_amount <= 0 ||
      order.currency.toLowerCase() !== "usd"
    )
      return null;
    // The invoiced line, rather than the subscription's mutable current period,
    // proves precisely which access period was purchased, including leap years.
    const periods = order.items.filter(
      (item) => !item.proration && item.start_timestamp && item.end_timestamp,
    );
    const line = periods[0];
    if (
      !line?.start_timestamp ||
      !line.end_timestamp ||
      periods.some(
        (item) =>
          item.start_timestamp !== line.start_timestamp ||
          item.end_timestamp !== line.end_timestamp,
      )
    )
      return null;
    const start = new Date(line.start_timestamp);
    const end = new Date(line.end_timestamp);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    )
      return null;
    let dispute: PaidOrder["dispute"] = "none";
    for await (const item of polar.disputes.iterList({
      order_id: order.id,
      limit: 100,
    })) {
      if (item.status === "lost") {
        dispute = "lost";
        break;
      }
      if (item.status !== "won" && item.status !== "prevented")
        dispute = "open";
      else if (item.status === "won" && dispute === "none") dispute = "won";
    }
    return {
      orderId: order.id,
      productId: order.product_id,
      start,
      end,
      totalAmount: order.total_amount,
      refundedAmount: order.refunded_amount + order.refunded_tax_amount,
      dispute,
    };
  }
  return {
    async fetchSnapshot(userId) {
      const subscriptions: models.Subscription[] = [];
      for await (const subscription of polar.subscriptions.iterList({
        external_customer_id: userId,
        limit: 100,
      }))
        subscriptions.push(subscription);
      const live = subscriptions.filter(
        (s) =>
          !s.ended_at && !["incomplete_expired", "canceled"].includes(s.status),
      );
      if (live.length > 1)
        throw new HttpError(
          409,
          "Multiple provider subscriptions require reconciliation.",
          "billing_duplicate_subscriptions",
          { contactUrl: config.BILLING_CONTACT_URL },
        );
      const subscription =
        live[0] ??
        subscriptions.sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        )[0];
      if (!subscription) return { kind: "none" };
      if (subscription.customer.external_id !== userId)
        throw new Error("Provider customer identity mismatch");
      const orders: PaidOrder[] = [];
      for await (const order of polar.orders.iterList({
        subscription_id: subscription.id,
        external_customer_id: userId,
        limit: 100,
      })) {
        const normalized = await normalizeOrder(order);
        if (normalized) orders.push(normalized);
      }
      const paidPeriod =
        orders.sort(
          (a, b) =>
            b.start.getTime() - a.start.getTime() ||
            b.end.getTime() - a.end.getTime(),
        )[0] ?? null;
      const pendingChoice = subscription.pending_update?.product_id
        ? choiceForProduct(config, subscription.pending_update.product_id)
        : null;
      return {
        kind: "subscription",
        customerId: subscription.customer_id,
        subscriptionId: subscription.id,
        productId: subscription.product_id,
        choice: paidPeriod
          ? choiceForProduct(config, paidPeriod.productId)
          : choiceForProduct(config, subscription.product_id),
        status: subscription.status,
        paidPeriod,
        orders,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        failedRenewal: ["past_due", "unpaid"].includes(subscription.status),
        revoked: Boolean(subscription.ended_at),
        pendingChange: pendingChoice
          ? {
              choice: pendingChoice,
              effectiveAt: new Date(subscription.current_period_end),
            }
          : null,
      };
    },
    async createCheckout({ userId, choice, attemptId }) {
      const product = productForChoice(config, choice);
      if (!product) throw new Error("Product is not configured");
      const result = await polar.checkouts.create({
        products: [product],
        external_customer_id: userId,
        metadata: { careersim_attempt_id: attemptId },
        success_url: returnUrl,
        return_url: returnUrl,
        allow_trial: false,
        allow_discount_codes: false,
      });
      return checkoutResult(result);
    },
    async findCheckout(attemptId) {
      // Correlation metadata belongs to us. It is never supplied by the browser.
      // Exhaust pagination so an ambiguous timeout never causes a blind retry.
      for await (const checkout of polar.checkouts.iterList({ limit: 100 })) {
        if (checkout.metadata.careersim_attempt_id === attemptId)
          return checkoutResult(checkout);
      }
      return null;
    },
    async createPortal(userId) {
      const result = await polar.customerSessions.create({
        external_customer_id: userId,
        return_url: returnUrl,
      });
      return { url: result.customer_portal_url };
    },
    async scheduleChange({ subscriptionId, choice }) {
      await polar.subscriptions.update(subscriptionId, {
        product_id: productForChoice(config, choice),
        proration_behavior: "next_period",
      });
    },
    async revokeSubscription(subscriptionId) {
      try {
        await polar.subscriptions.revoke(subscriptionId);
      } catch (error) {
        // A successful revoke whose response was lost is safe to retry.
        if (
          !(error instanceof PolarClientError) ||
          ![403, 404, 409].includes(error.statusCode)
        )
          throw error;
        if (error.statusCode !== 404) {
          const current = await polar.subscriptions.get(subscriptionId);
          if (!current.ended_at) throw error;
        }
      }
    },
  };
}
