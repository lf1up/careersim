import { z } from "zod";
import { HttpError } from "../../plugins/errors.js";
import {
  choiceForProduct,
  productForChoice,
  type BillingConfig,
} from "./catalog.js";
import type { BillingSnapshot, PaidOrder } from "./billing.schema.js";
import { billingCountrySchema } from "./routing.js";
import type {
  BillingProvider,
  ProviderCheckout,
  ProviderReferences,
} from "./provider.js";

const id = z.string().min(1);
const reference = z
  .union([id, z.object({ id })])
  .transform((value) => (typeof value === "string" ? value : value.id));
const customerReference = z
  .union([id, z.object({ id, country: z.unknown().optional() })])
  .transform((value) => {
    const country = billingCountrySchema.safeParse(
      typeof value === "string" ? undefined : value.country,
    );
    return {
      id: typeof value === "string" ? value : value.id,
      billingCountry: country.success ? country.data : undefined,
    };
  });
const metadata = z.object({
  careersim_user_id: z.string().optional(),
  careersim_attempt_id: z.string().optional(),
});
const hostedUrl = z
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const checkoutSchema = z.object({
  id,
  status: z.enum(["pending", "processing", "completed", "expired"]),
  product: reference,
  request_id: z.string().nullish(),
  checkout_url: hostedUrl,
  customer: reference.nullish(),
  subscription: reference.nullish(),
  order: z.object({ id, product: reference.optional() }).nullish(),
  metadata: metadata.optional(),
});
const subscriptionSchema = z.object({
  id,
  customer: customerReference,
  product: reference,
  status: z.enum([
    "active",
    "canceled",
    "unpaid",
    "paused",
    "trialing",
    "scheduled_cancel",
    "past_due",
  ]),
  created_at: z.iso.datetime({ offset: true }),
  current_period_start_date: z.iso.datetime({ offset: true }).nullish(),
  current_period_end_date: z.iso.datetime({ offset: true }).nullish(),
  last_transaction_id: z.string().nullish(),
  metadata: metadata.nullish(),
});
const transactionSchema = z.object({
  id,
  amount: z.number(),
  amount_paid: z.number().nullish(),
  refunded_amount: z.number().nullish(),
  currency: z.string(),
  type: z.string(),
  status: z.string(),
  customer: reference.nullish(),
  subscription: reference.nullish(),
  order: reference.nullish(),
  period_start: z.number().nullish(),
  period_end: z.number().nullish(),
});
const transactionsSchema = z.object({
  items: z.array(transactionSchema),
  pagination: z.object({
    current_page: z.number().int().positive(),
    next_page: z.number().int().positive().nullable(),
  }),
});
type Checkout = z.infer<typeof checkoutSchema>;
type Subscription = z.infer<typeof subscriptionSchema>;
type Transaction = z.infer<typeof transactionSchema>;

/** Creem wire DTOs stay here; a subscription status is never payment proof. */
export function createCreemProvider(
  config: BillingConfig,
  request: typeof fetch = fetch,
): BillingProvider {
  const origin =
    config.CREEM_ENVIRONMENT === "production"
      ? "https://api.creem.io"
      : "https://test-api.creem.io";
  const returnUrl = new URL(
    "/profile?billing=return",
    config.WEB_APP_URL,
  ).toString();
  const verifiedCustomers = new Map<string, string>();
  function providerError(): HttpError {
    return new HttpError(
      502,
      "Billing provider request failed. Try again or contact support.",
      "billing_provider_error",
    );
  }
  function mismatch(): never {
    throw new HttpError(
      409,
      "Billing identity requires reconciliation. Contact support.",
      "billing_identity_mismatch",
    );
  }
  function duplicate(): never {
    throw new HttpError(
      409,
      "Multiple provider subscriptions require reconciliation.",
      "billing_duplicate_subscriptions",
      { contactUrl: config.BILLING_CONTACT_URL },
    );
  }
  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: object,
    allowMissing = false,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await request(new URL(path, origin), {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "x-api-key": config.CREEM_API_KEY,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw providerError();
    }
    if (response.status === 404 && allowMissing && body === undefined)
      return null;
    if (!response.ok) throw providerError();
    try {
      return schema.parse(await response.json());
    } catch {
      throw providerError();
    }
  }
  function checkoutResult(checkout: Checkout): ProviderCheckout {
    return {
      id: checkout.id,
      url: checkout.checkout_url,
      expiresAt: null,
      state:
        checkout.status === "completed"
          ? "completed"
          : checkout.status === "expired"
            ? "closed"
            : "open",
    };
  }
  function verifyAttempt(checkout: Checkout, attemptId: string): void {
    if (
      checkout.request_id !== attemptId ||
      checkout.metadata?.careersim_attempt_id !== attemptId
    )
      mismatch();
  }
  async function getCheckout(checkoutId: string): Promise<Checkout | null> {
    const checkout = await call(
      `/v1/checkouts?${new URLSearchParams({ checkout_id: checkoutId })}`,
      checkoutSchema,
      undefined,
      true,
    );
    if (checkout && checkout.id !== checkoutId) mismatch();
    return checkout;
  }
  function normalizeOrder(
    transaction: Transaction,
    subscription: Subscription,
    orderProducts: Map<string, { productId: string; checkoutId: string }>,
    knownOrders: Map<string, NonNullable<ProviderReferences["orders"]>[number]>,
  ): PaidOrder | null {
    const knownOrder = knownOrders.get(transaction.id);
    const refundedAmount =
      transaction.refunded_amount ?? (transaction.status === "paid" ? 0 : null);
    if (
      knownOrder &&
      (knownOrder.subscriptionId !== transaction.subscription ||
        knownOrder.start.getTime() !== transaction.period_start ||
        knownOrder.end.getTime() !== transaction.period_end)
    )
      mismatch();
    if (
      transaction.subscription !== subscription.id ||
      transaction.type !== "invoice" ||
      ![
        "paid",
        "refunded",
        "partialRefund",
        "partially_refunded",
        "chargeback",
        "chargedBack",
      ].includes(transaction.status) ||
      !Number.isSafeInteger(transaction.amount) ||
      transaction.amount <= 0 ||
      transaction.currency !== "USD" ||
      !Number.isSafeInteger(transaction.amount_paid) ||
      transaction.amount_paid == null ||
      transaction.amount_paid <= 0 ||
      !Number.isSafeInteger(refundedAmount) ||
      refundedAmount == null ||
      refundedAmount < 0 ||
      refundedAmount > transaction.amount_paid ||
      (transaction.status === "refunded" &&
        refundedAmount !== transaction.amount_paid) ||
      (["partialRefund", "partially_refunded"].includes(transaction.status) &&
        refundedAmount === 0) ||
      transaction.period_start == null ||
      transaction.period_end == null
    )
      return null;
    const start = new Date(transaction.period_start);
    const end = new Date(transaction.period_end);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    )
      return null;
    const ownedOrder = transaction.order
      ? orderProducts.get(transaction.order)
      : undefined;
    if (
      ownedOrder &&
      knownOrder &&
      ownedOrder.productId !== knownOrder.productId
    )
      mismatch();
    // The API has no historical product field. Never apply today's plan to an old invoice.
    const productId =
      knownOrder?.productId ??
      ownedOrder?.productId ??
      (transaction.id === subscription.last_transaction_id &&
      start.getTime() ===
        Date.parse(subscription.current_period_start_date ?? "") &&
      end.getTime() === Date.parse(subscription.current_period_end_date ?? "")
        ? subscription.product
        : null);
    if (!productId || !choiceForProduct(config, productId, "creem"))
      return null;
    return {
      orderId: transaction.id,
      checkoutId: ownedOrder?.checkoutId ?? null,
      productId,
      start,
      end,
      totalAmount: transaction.amount_paid,
      refundedAmount,
      // The public API cannot prove a chargeback was won. Persist suspension until verified resolution.
      dispute: ["chargeback", "chargedBack"].includes(transaction.status)
        ? "open"
        : "none",
    };
  }
  return {
    async createCheckout({ userId, choice, attemptId, customerId }) {
      const productId = productForChoice(config, choice, "creem");
      if (!productId)
        throw new HttpError(
          409,
          "This billing plan is unavailable.",
          "billing_product_unavailable",
        );
      const checkout = await call("/v1/checkouts", checkoutSchema, {
        product_id: productId,
        request_id: attemptId,
        success_url: returnUrl,
        metadata: {
          careersim_user_id: userId,
          careersim_attempt_id: attemptId,
        },
        ...(customerId ? { customer: { id: customerId } } : {}),
      });
      if (!checkout) throw providerError();
      verifyAttempt(checkout, attemptId);
      if (
        checkout.metadata?.careersim_user_id !== userId ||
        checkout.product !== productId ||
        (customerId && checkout.customer && checkout.customer !== customerId)
      )
        mismatch();
      return checkoutResult(checkout);
    },
    async findCheckout(attemptId, checkoutId) {
      // request_id is correlation, not documented idempotency or a lookup endpoint.
      if (!checkoutId) return null;
      const checkout = await getCheckout(checkoutId);
      if (!checkout) return null;
      verifyAttempt(checkout, attemptId);
      return checkoutResult(checkout);
    },
    async fetchSnapshot(userId, references) {
      verifiedCustomers.delete(userId);
      let customerId = references?.customerId ?? null;
      const subscriptionIds = new Set(references?.subscriptionIds ?? []);
      const orderProducts = new Map<
        string,
        { productId: string; checkoutId: string }
      >();
      const knownOrders = new Map(
        (references?.orders ?? []).map((order) => [order.orderId, order]),
      );
      for (const attempt of references?.checkouts ?? []) {
        if (!attempt.checkoutId) continue;
        const checkout = await getCheckout(attempt.checkoutId);
        if (!checkout) continue;
        verifyAttempt(checkout, attempt.attemptId);
        if (
          checkout.metadata?.careersim_user_id !== userId ||
          checkout.product !==
            productForChoice(config, attempt.choice, "creem") ||
          (checkout.customer && customerId && checkout.customer !== customerId)
        )
          mismatch();
        if (checkout.status !== "completed") continue;
        if (!checkout.customer || !checkout.subscription) mismatch();
        customerId = checkout.customer;
        subscriptionIds.add(checkout.subscription);
        if (checkout.order) {
          if (
            checkout.order.product &&
            checkout.order.product !== checkout.product
          )
            mismatch();
          orderProducts.set(checkout.order.id, {
            productId: checkout.product,
            checkoutId: checkout.id,
          });
        }
      }
      if (!subscriptionIds.size) return { kind: "none" };
      if (!customerId) mismatch();
      const subscriptions: Subscription[] = [];
      for (const subscriptionId of subscriptionIds) {
        const subscription = await call(
          `/v1/subscriptions?${new URLSearchParams({ subscription_id: subscriptionId })}`,
          subscriptionSchema,
        );
        if (!subscription) throw providerError();
        if (
          subscription.id !== subscriptionId ||
          subscription.customer.id !== customerId ||
          (subscription.metadata?.careersim_user_id !== undefined &&
            subscription.metadata.careersim_user_id !== userId)
        )
          mismatch();
        subscriptions.push(subscription);
      }
      if (subscriptions.filter((item) => item.status !== "canceled").length > 1)
        duplicate();
      const transactions = new Map<string, Transaction>();
      for (let pageNumber = 1; ;) {
        const page: z.infer<typeof transactionsSchema> | null = await call(
          `/v1/transactions/search?${new URLSearchParams({ customer_id: customerId, page_number: String(pageNumber), page_size: "100" })}`,
          transactionsSchema,
        );
        if (!page || page.pagination.current_page !== pageNumber)
          throw providerError();
        for (const transaction of page.items) {
          if (transaction.customer !== customerId) mismatch();
          const previous = transactions.get(transaction.id);
          if (
            previous &&
            JSON.stringify(previous) !== JSON.stringify(transaction)
          )
            throw providerError();
          transactions.set(transaction.id, transaction);
        }
        if (page.pagination.next_page === null) break;
        if (page.pagination.next_page <= pageNumber) throw providerError();
        pageNumber = page.pagination.next_page;
      }
      const snapshots: Extract<BillingSnapshot, { kind: "subscription" }>[] =
        subscriptions.map((subscription) => {
          const orders = [...transactions.values()]
            .flatMap((transaction) => {
              const order = normalizeOrder(
                transaction,
                subscription,
                orderProducts,
                knownOrders,
              );
              return order ? [order] : [];
            })
            .sort(
              (a, b) =>
                b.start.getTime() - a.start.getTime() ||
                b.end.getTime() - a.end.getTime(),
            );
          const paidPeriod = orders[0] ?? null;
          return {
            kind: "subscription",
            customerId: subscription.customer.id,
            ...(subscription.customer.billingCountry
              ? { billingCountry: subscription.customer.billingCountry }
              : {}),
            subscriptionId: subscription.id,
            productId: subscription.product,
            choice: choiceForProduct(
              config,
              paidPeriod?.productId ?? subscription.product,
              "creem",
            ),
            status: subscription.status,
            orders,
            paidPeriod,
            cancelAtPeriodEnd: ["canceled", "scheduled_cancel"].includes(
              subscription.status,
            ),
            failedRenewal: ["past_due", "unpaid"].includes(subscription.status),
            // Creem canceled does not distinguish voluntary and immediate cancellation reliably.
            revoked: false,
            pendingChange: null,
          };
        });
      const obligations = snapshots.filter(
        (item) =>
          item.status !== "canceled" ||
          (item.paidPeriod &&
            item.paidPeriod.end.getTime() > Date.now() &&
            item.paidPeriod.refundedAmount < item.paidPeriod.totalAmount),
      );
      if (obligations.length > 1) duplicate();
      const selected =
        obligations[0] ??
        snapshots.sort((a, b) => {
          const aCreated =
            subscriptions.find((item) => item.id === a.subscriptionId)
              ?.created_at ?? "";
          const bCreated =
            subscriptions.find((item) => item.id === b.subscriptionId)
              ?.created_at ?? "";
          return bCreated.localeCompare(aCreated);
        })[0];
      if (!selected) return { kind: "none" };
      verifiedCustomers.set(userId, selected.customerId);
      return selected;
    },
    async createPortal(userId) {
      const customerId = verifiedCustomers.get(userId);
      if (!customerId)
        throw new HttpError(
          409,
          "Refresh your billing status before opening the billing portal.",
          "billing_customer_missing",
        );
      const result = await call(
        "/v1/customers/billing",
        z.object({ customer_portal_link: hostedUrl }),
        { customer_id: customerId },
      );
      if (!result) throw providerError();
      return { url: result.customer_portal_link };
    },
    async scheduleChange() {
      throw new HttpError(
        409,
        "Plan changes are unavailable. Contact support.",
        "billing_plan_changes_unavailable",
        { contactUrl: config.BILLING_CONTACT_URL },
      );
    },
    async revokeSubscription(subscriptionId) {
      const canceledSchema = z.object({ id, status: z.literal("canceled") });
      try {
        const canceled = await call(
          `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
          canceledSchema,
          { mode: "immediate", onExecute: "cancel" },
        );
        if (!canceled || canceled.id !== subscriptionId) throw providerError();
      } catch (error) {
        // A lost POST response is resolved by reading state, never by replaying the charge-affecting call.
        const current = await call(
          `/v1/subscriptions?${new URLSearchParams({ subscription_id: subscriptionId })}`,
          canceledSchema,
          undefined,
          true,
        );
        if (current && current.id !== subscriptionId) throw error;
      }
    },
  };
}
