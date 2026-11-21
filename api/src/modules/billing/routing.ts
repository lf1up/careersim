import { z } from "zod";
import { HttpError } from "../../plugins/errors.js";

export const billingProviderIdSchema = z.enum(["creem", "polar"]);
export type BillingProviderId = z.infer<typeof billingProviderIdSchema>;
export const billingCountries =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );
const countryCodes = new Set(billingCountries);
export const billingCountrySchema = z
  .string()
  .refine(
    (value) => countryCodes.has(value),
    "Use an ISO billing country code",
  );
export const countryRoutesSchema = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const routes: Partial<Record<string, BillingProviderId>> = {};
    if (!value.trim()) return routes;
    for (const item of value.split(",")) {
      const [country, provider, extra] = item.trim().split("=");
      const parsed = billingProviderIdSchema.safeParse(provider);
      if (
        !country ||
        !countryCodes.has(country) ||
        !parsed.success ||
        extra !== undefined ||
        country in routes
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Use unique ISO country=provider routes",
        });
        return z.NEVER;
      }
      routes[country] = parsed.data;
    }
    return routes;
  });
export interface BillingRoutingConfig {
  BILLING_DEFAULT_PROVIDER: BillingProviderId;
  BILLING_COUNTRY_PROVIDERS: Partial<Record<string, BillingProviderId>>;
  CREEM_ENABLED: boolean;
  POLAR_ENABLED: boolean;
}
export function providerEnabled(
  config: BillingRoutingConfig,
  provider: BillingProviderId,
): boolean {
  return provider === "creem" ? config.CREEM_ENABLED : config.POLAR_ENABLED;
}
export function selectBillingProvider(
  config: BillingRoutingConfig,
  country?: string,
): BillingProviderId {
  if (country !== undefined) billingCountrySchema.parse(country);
  if (!country && Object.keys(config.BILLING_COUNTRY_PROVIDERS).length)
    throw new HttpError(
      400,
      "Select your billing country before checkout.",
      "billing_country_required",
    );
  const provider =
    (country && config.BILLING_COUNTRY_PROVIDERS[country]) ||
    config.BILLING_DEFAULT_PROVIDER;
  if (!providerEnabled(config, provider))
    throw new HttpError(
      409,
      "This billing provider is unavailable.",
      "billing_provider_disabled",
    );
  return provider;
}
