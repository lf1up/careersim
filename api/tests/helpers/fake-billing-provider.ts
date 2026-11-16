import type {
  BillingSnapshot,
  BillingChoice,
} from "../../src/modules/billing/billing.schema.js";
import type {
  BillingProvider,
  ProviderCheckout,
} from "../../src/modules/billing/polar.js";
export class FakeBillingProvider implements BillingProvider {
  snapshots = new Map<string, BillingSnapshot>();
  checkouts = new Map<string, ProviderCheckout>();
  created: Array<{ userId: string; choice: BillingChoice; attemptId: string }> =
    [];
  revoked: string[] = [];
  failFetch = false;
  failFetchFor = new Set<string>();
  timeoutAfterCreate = false;
  async fetchSnapshot(userId: string) {
    if (this.failFetch || this.failFetchFor.has(userId))
      throw new Error("Provider unavailable");
    return this.snapshots.get(userId) ?? { kind: "none" as const };
  }
  async createCheckout(input: {
    userId: string;
    choice: BillingChoice;
    attemptId: string;
  }) {
    this.created.push(input);
    const result = {
      id: `checkout-${input.attemptId}`,
      url: `https://checkout.polar.sh/${input.attemptId}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    this.checkouts.set(input.attemptId, result);
    if (this.timeoutAfterCreate) {
      this.timeoutAfterCreate = false;
      throw new Error("Network timeout");
    }
    return result;
  }
  async findCheckout(attemptId: string) {
    return this.checkouts.get(attemptId) ?? null;
  }
  async createPortal(userId: string) {
    return { url: `https://polar.sh/portal/${userId}` };
  }
  async scheduleChange(_input: {
    subscriptionId: string;
    choice: BillingChoice;
  }) {}
  async revokeSubscription(id: string) {
    this.revoked.push(id);
  }
}
