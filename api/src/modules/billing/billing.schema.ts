import { z } from "zod";

export const tierSchema = z.enum(["free", "plus", "supporter"]);
export const paidTierSchema = z.enum(["plus", "supporter"]);
export const billingIntervalSchema = z.enum(["month", "year"]);
export const billingChoiceSchema = z.strictObject({
  tier: paidTierSchema,
  interval: billingIntervalSchema,
});
export type Tier = z.infer<typeof tierSchema>;
export type PaidTier = z.infer<typeof paidTierSchema>;
export type BillingInterval = z.infer<typeof billingIntervalSchema>;
export type BillingChoice = z.infer<typeof billingChoiceSchema>;
export const planLimitsSchema = z.object({
  sessionsCreateMax: z.number().int().positive(),
  sessionsWindowMs: z.number().int().positive(),
  chatMessagesMax: z.number().int().positive(),
  chatWindowMs: z.number().int().positive(),
  customSimulationsMax: z.number().int().nonnegative(),
  customPersonasMax: z.number().int().nonnegative(),
  voiceDailyMinutes: z.number().int().nonnegative(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;
export const availabilitySchema = z.enum([
  "available",
  "billing_disabled",
  "coming_soon",
]);
export const planCatalogSchema = z.object({
  currency: z.literal("USD"),
  contactUrl: z.string(),
  higherLimitsMessage: z.string(),
  plans: z.array(
    z.object({
      tier: tierSchema,
      name: z.string(),
      limits: planLimitsSchema,
      benefits: z.array(z.string()),
      availability: availabilitySchema,
      prices: z.array(
        z.object({
          interval: billingIntervalSchema,
          amountCents: z.number().int().nonnegative(),
          discountLabel: z.string().nullable(),
        }),
      ),
    }),
  ),
  // Plan changes remain unavailable until sandbox verifies every transition.
  planChangesAvailable: z.boolean(),
});
export type PlanCatalog = z.infer<typeof planCatalogSchema>;
export const paidOrderSchema = z.object({
  orderId: z.string(),
  productId: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  totalAmount: z.number().int().nonnegative(),
  refundedAmount: z.number().int().nonnegative(),
  dispute: z.enum(["none", "open", "lost", "won"]),
});
export type PaidOrder = z.infer<typeof paidOrderSchema>;
export const pendingChangeSchema = z.object({
  choice: billingChoiceSchema,
  effectiveAt: z.coerce.date(),
});
export const billingSnapshotSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("subscription"),
    customerId: z.string(),
    subscriptionId: z.string(),
    productId: z.string(),
    choice: billingChoiceSchema.nullable(),
    status: z.string(),
    paidPeriod: paidOrderSchema.nullable(),
    orders: z.array(paidOrderSchema),
    cancelAtPeriodEnd: z.boolean(),
    failedRenewal: z.boolean(),
    revoked: z.boolean(),
    pendingChange: pendingChangeSchema.nullable(),
  }),
]);
export type BillingSnapshot = z.infer<typeof billingSnapshotSchema>;
export const entitlementSchema = z.object({
  tier: tierSchema,
  limits: planLimitsSchema,
  supporterAccess: z.boolean(),
  reason: z.enum(["free", "paid", "grace", "expired", "revoked", "disputed"]),
});
export type Entitlement = z.infer<typeof entitlementSchema>;
// Usage is provided by each counter owner. Null means temporarily unavailable,
// never a claim that the user has consumed nothing.
export const usageMetricSchema = z.object({
  used: z.number().nonnegative(),
  limit: z.number().nonnegative(),
  resetAt: z.string().nullable(),
});
export const billingUsageSchema = z.object({
  sessions: usageMetricSchema.nullable(),
  chatMessages: usageMetricSchema.nullable(),
  customSimulations: usageMetricSchema.nullable(),
  customPersonas: usageMetricSchema.nullable(),
  voice: usageMetricSchema.nullable(),
});
export type BillingUsage = z.infer<typeof billingUsageSchema>;
export const billingAccountSchema = entitlementSchema.extend({
  interval: billingIntervalSchema.nullable(),
  paidThrough: z.string().nullable(),
  accessThrough: z.string().nullable(),
  status: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  renews: z.boolean(),
  pendingChange: z
    .object({ choice: billingChoiceSchema, effectiveAt: z.string() })
    .nullable(),
  pendingCheckout: z.boolean(),
  confirmationPending: z.boolean(),
  usage: billingUsageSchema,
  planChangesAvailable: z.boolean(),
  contactUrl: z.string(),
});
export type BillingAccount = z.infer<typeof billingAccountSchema>;
