import { z } from "zod";

const priceCents = z.coerce.number().int().positive().max(2_147_483_647);

export const billingPricesSchema = z.object({
  PRO_MONTHLY_PRICE_CENTS: priceCents.default(900),
  PRO_YEARLY_PRICE_CENTS: priceCents.default(9000),
  SUPPORTER_MONTHLY_PRICE_CENTS: priceCents.default(4900),
  SUPPORTER_YEARLY_PRICE_CENTS: priceCents.default(49000),
});

export type BillingPrices = z.infer<typeof billingPricesSchema>;
