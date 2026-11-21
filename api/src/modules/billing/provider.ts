import type { BillingChoice, BillingSnapshot } from "./billing.schema.js";
import type { BillingProviderId } from "./routing.js";
import { HttpError } from "../../plugins/errors.js";
export interface ProviderReferences {
  orders?: Array<{
    orderId: string;
    checkoutId?: string | null;
    productId: string;
    subscriptionId: string;
    start: Date;
    end: Date;
  }>;
  customerId: string | null;
  subscriptionIds: string[];
  checkouts: Array<{
    attemptId: string;
    checkoutId: string | null;
    choice: BillingChoice;
  }>;
}
export interface BillingProvider {
  fetchSnapshot(
    userId: string,
    references?: ProviderReferences,
  ): Promise<BillingSnapshot>;
  createCheckout(input: {
    userId: string;
    choice: BillingChoice;
    attemptId: string;
    customerId?: string | null;
  }): Promise<{
    id: string;
    url: string;
    expiresAt: Date | null;
    state?: "open" | "completed" | "closed";
  }>;
  findCheckout(
    attemptId: string,
    checkoutId?: string | null,
  ): Promise<ProviderCheckout | null>;
  updateCheckout?(input: {
    checkoutId: string;
    choice: BillingChoice;
  }): Promise<ProviderCheckout>;
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

export type BillingProviders = Partial<
  Record<BillingProviderId, BillingProvider>
>;
export function requireProvider(
  providers: BillingProviders,
  id: BillingProviderId,
): BillingProvider {
  const provider = providers[id];
  if (!provider)
    throw new HttpError(
      503,
      "This billing provider is unavailable. Contact support.",
      "billing_provider_disabled",
    );
  return provider;
}
