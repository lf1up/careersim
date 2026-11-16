import { z } from "zod";

const priceCents = z.coerce.number().int().positive().max(2_147_483_647);

export const billingPricesSchema = z.object({
  PLUS_MONTHLY_PRICE_CENTS: priceCents.default(900),
  PLUS_YEARLY_PRICE_CENTS: priceCents.default(9000),
  PRO_MONTHLY_PRICE_CENTS: priceCents.default(4900),
  PRO_YEARLY_PRICE_CENTS: priceCents.default(49000),
});

export type BillingPrices = z.infer<typeof billingPricesSchema>;

export function tierEnvironmentMigrationError(source: NodeJS.ProcessEnv): string | undefined {
  const legacy = Object.keys(source).filter(
    (key) => key.startsWith("SUPPORTER_") || key.startsWith("POLAR_SUPPORTER_"),
  );
  if (legacy.length) {
    return `Legacy tier settings found (${legacy.join(", ")}). Move old PRO_* values to PLUS_* before renaming SUPPORTER_* to PRO_* and POLAR_SUPPORTER_* to POLAR_PRO_*.`;
  }
}
