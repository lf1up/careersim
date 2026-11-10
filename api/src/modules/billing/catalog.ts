import type { Env } from "../../config/env.js";
import type {
  BillingChoice,
  PlanCatalog,
  PlanLimits,
} from "./billing.schema.js";
export type BillingConfig = Pick<
  Env,
  | "BILLING_ENABLED"
  | "POLAR_ENVIRONMENT"
  | "POLAR_ACCESS_TOKEN"
  | "POLAR_WEBHOOK_SECRET"
  | "POLAR_PLUS_MONTHLY_PRODUCT_ID"
  | "POLAR_PLUS_YEARLY_PRODUCT_ID"
  | "POLAR_SUPPORTER_MONTHLY_PRODUCT_ID"
  | "POLAR_SUPPORTER_YEARLY_PRODUCT_ID"
  | "SUPPORTER_CHECKOUT_ENABLED"
  | "SUPPORTER_CHANNEL_URL"
  | "BILLING_CONTACT_URL"
  | "WEB_APP_URL"
  | "SESSIONS_CREATE_MAX"
  | "SESSIONS_CREATE_WINDOW_MS"
  | "CHAT_MESSAGES_MAX"
  | "CHAT_MESSAGES_WINDOW_MS"
  | "CUSTOM_SIMULATIONS_MAX"
  | "CUSTOM_PERSONAS_MAX"
  | "VOICE_DAILY_MINUTES_PER_USER"
  | "PRO_SESSIONS_CREATE_MAX"
  | "PRO_CHAT_MESSAGES_MAX"
  | "PRO_CUSTOM_SIMULATIONS_MAX"
  | "PRO_CUSTOM_PERSONAS_MAX"
  | "PRO_VOICE_DAILY_MINUTES_PER_USER"
>;
const coreBenefits = ["Core scenarios", "Feedback", "Saved practice history"];
export const supporterBenefits = [
  "Guidance and support from the development team",
  "Chat directly with the developers",
  "Help decide the project's future together",
];
export function buildPlanCatalog(config: BillingConfig): PlanCatalog {
  const free: PlanLimits = {
    sessionsCreateMax: config.SESSIONS_CREATE_MAX,
    sessionsWindowMs: config.SESSIONS_CREATE_WINDOW_MS,
    chatMessagesMax: config.CHAT_MESSAGES_MAX,
    chatWindowMs: config.CHAT_MESSAGES_WINDOW_MS,
    customSimulationsMax: config.CUSTOM_SIMULATIONS_MAX,
    customPersonasMax: config.CUSTOM_PERSONAS_MAX,
    voiceDailyMinutes: config.VOICE_DAILY_MINUTES_PER_USER,
  };
  const paid: PlanLimits = {
    ...free,
    sessionsCreateMax: config.PRO_SESSIONS_CREATE_MAX,
    chatMessagesMax: config.PRO_CHAT_MESSAGES_MAX,
    customSimulationsMax: config.PRO_CUSTOM_SIMULATIONS_MAX,
    customPersonasMax: config.PRO_CUSTOM_PERSONAS_MAX,
    voiceDailyMinutes: config.PRO_VOICE_DAILY_MINUTES_PER_USER,
  };
  return {
    currency: "USD",
    contactUrl: config.BILLING_CONTACT_URL,
    higherLimitsMessage:
      "Need higher limits? Contact us to discuss your needs.",
    planChangesAvailable: false,
    plans: [
      {
        tier: "free",
        name: "Free",
        limits: free,
        benefits: coreBenefits,
        availability: "available",
        prices: [],
      },
      {
        tier: "plus",
        name: "Plus",
        limits: paid,
        benefits: coreBenefits,
        availability: config.BILLING_ENABLED ? "available" : "billing_disabled",
        prices: [
          { interval: "month", amountCents: 900, discountLabel: null },
          {
            interval: "year",
            amountCents: 9000,
            discountLabel: "2 months free",
          },
        ],
      },
      {
        tier: "supporter",
        name: "Supporter",
        limits: paid,
        benefits: [...coreBenefits, ...supporterBenefits],
        availability: !config.BILLING_ENABLED
          ? "billing_disabled"
          : config.SUPPORTER_CHECKOUT_ENABLED && config.SUPPORTER_CHANNEL_URL
            ? "available"
            : "coming_soon",
        prices: [
          { interval: "month", amountCents: 10000, discountLabel: null },
          {
            interval: "year",
            amountCents: 100000,
            discountLabel: "2 months free",
          },
        ],
      },
    ],
  };
}
export function productForChoice(
  config: BillingConfig,
  choice: BillingChoice,
): string {
  return choice.tier === "plus"
    ? choice.interval === "month"
      ? config.POLAR_PLUS_MONTHLY_PRODUCT_ID
      : config.POLAR_PLUS_YEARLY_PRODUCT_ID
    : choice.interval === "month"
      ? config.POLAR_SUPPORTER_MONTHLY_PRODUCT_ID
      : config.POLAR_SUPPORTER_YEARLY_PRODUCT_ID;
}
export function choiceForProduct(
  config: BillingConfig,
  id: string,
): BillingChoice | null {
  if (!id) return null;
  for (const tier of ["plus", "supporter"] as const)
    for (const interval of ["month", "year"] as const) {
      const choice = { tier, interval };
      if (productForChoice(config, choice) === id) return choice;
    }
  return null;
}
