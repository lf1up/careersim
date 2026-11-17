import { providerEnabled, type BillingProviderId } from "./routing.js";
import type { Env } from "../../config/env.js";
import type {
  BillingChoice,
  PlanCatalog,
  PlanLimits,
} from "./billing.schema.js";
export type BillingConfig = Pick<
  Env,
  | "BILLING_ENABLED"
  | "BILLING_DEFAULT_PROVIDER"
  | "BILLING_COUNTRY_PROVIDERS"
  | "CREEM_ENABLED"
  | "POLAR_ENABLED"
  | "CREEM_ENVIRONMENT"
  | "CREEM_API_KEY"
  | "CREEM_WEBHOOK_SECRET"
  | "CREEM_PLUS_MONTHLY_PRODUCT_ID"
  | "CREEM_PLUS_YEARLY_PRODUCT_ID"
  | "CREEM_PRO_MONTHLY_PRODUCT_ID"
  | "CREEM_PRO_YEARLY_PRODUCT_ID"
  | "POLAR_ENVIRONMENT"
  | "POLAR_ACCESS_TOKEN"
  | "POLAR_WEBHOOK_SECRET"
  | "POLAR_PLUS_MONTHLY_PRODUCT_ID"
  | "POLAR_PLUS_YEARLY_PRODUCT_ID"
  | "POLAR_PRO_MONTHLY_PRODUCT_ID"
  | "POLAR_PRO_YEARLY_PRODUCT_ID"
  | "PRO_CHANNEL_URL"
  | "BILLING_CONTACT_URL"
  | "WEB_APP_URL"
  | "SESSIONS_CREATE_MAX"
  | "SESSIONS_CREATE_WINDOW_MS"
  | "CHAT_MESSAGES_MAX"
  | "CHAT_MESSAGES_WINDOW_MS"
  | "CUSTOM_SIMULATIONS_MAX"
  | "CUSTOM_PERSONAS_MAX"
  | "VOICE_DAILY_MINUTES_PER_USER"
  | "PLUS_SESSIONS_CREATE_MAX"
  | "PLUS_CHAT_MESSAGES_MAX"
  | "PLUS_CUSTOM_SIMULATIONS_MAX"
  | "PLUS_CUSTOM_PERSONAS_MAX"
  | "PLUS_VOICE_DAILY_MINUTES_PER_USER"
  | "PRO_SESSIONS_CREATE_MAX"
  | "PRO_CHAT_MESSAGES_MAX"
  | "PRO_CUSTOM_SIMULATIONS_MAX"
  | "PRO_CUSTOM_PERSONAS_MAX"
  | "PRO_VOICE_DAILY_MINUTES_PER_USER"
  | "PLUS_MONTHLY_PRICE_CENTS"
  | "PLUS_YEARLY_PRICE_CENTS"
  | "PRO_MONTHLY_PRICE_CENTS"
  | "PRO_YEARLY_PRICE_CENTS"
>;
const coreBenefits = [
  "Core scenarios",
  "Feedback",
  "Saved practice history",
  "Creator plugin access for custom personas and simulations",
];
export const proBenefits = [
  "Guidance and support from the development team",
  "Chat directly with the developers",
  "Help decide the project's future together",
  "Early access to upcoming features, including MCP and API access",
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
  const plus: PlanLimits = {
    ...free,
    sessionsCreateMax: config.PLUS_SESSIONS_CREATE_MAX,
    chatMessagesMax: config.PLUS_CHAT_MESSAGES_MAX,
    customSimulationsMax: config.PLUS_CUSTOM_SIMULATIONS_MAX,
    customPersonasMax: config.PLUS_CUSTOM_PERSONAS_MAX,
    voiceDailyMinutes: config.PLUS_VOICE_DAILY_MINUTES_PER_USER,
  };
  const pro: PlanLimits = {
    ...free,
    sessionsCreateMax: config.PRO_SESSIONS_CREATE_MAX,
    chatMessagesMax: config.PRO_CHAT_MESSAGES_MAX,
    customSimulationsMax: config.PRO_CUSTOM_SIMULATIONS_MAX,
    customPersonasMax: config.PRO_CUSTOM_PERSONAS_MAX,
    voiceDailyMinutes: config.PRO_VOICE_DAILY_MINUTES_PER_USER,
  };
  return {
    currency: "USD",
    billingCountryRequired:
      Object.keys(config.BILLING_COUNTRY_PROVIDERS).length > 0,
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
        limits: plus,
        benefits: coreBenefits,
        availability: config.BILLING_ENABLED ? "available" : "billing_disabled",
        prices: [
          {
            interval: "month",
            amountCents: config.PLUS_MONTHLY_PRICE_CENTS,
            discountLabel: null,
          },
          {
            interval: "year",
            amountCents: config.PLUS_YEARLY_PRICE_CENTS,
            discountLabel:
              config.PLUS_YEARLY_PRICE_CENTS ===
              config.PLUS_MONTHLY_PRICE_CENTS * 10
                ? "2 months free"
                : null,
          },
        ],
      },
      {
        tier: "pro",
        name: "Pro",
        limits: pro,
        benefits: [...coreBenefits, ...proBenefits],
        availability: !config.BILLING_ENABLED
          ? "billing_disabled"
          : (["creem", "polar"] as const).some(
                (provider) =>
                  providerEnabled(config, provider) &&
                  productForChoice(
                    config,
                    { tier: "pro", interval: "month" },
                    provider,
                  ) &&
                  productForChoice(
                    config,
                    { tier: "pro", interval: "year" },
                    provider,
                  ),
              ) && config.PRO_CHANNEL_URL
            ? "available"
            : "coming_soon",
        prices: [
          {
            interval: "month",
            amountCents: config.PRO_MONTHLY_PRICE_CENTS,
            discountLabel: null,
          },
          {
            interval: "year",
            amountCents: config.PRO_YEARLY_PRICE_CENTS,
            discountLabel:
              config.PRO_YEARLY_PRICE_CENTS ===
              config.PRO_MONTHLY_PRICE_CENTS * 10
                ? "2 months free"
                : null,
          },
        ],
      },
    ],
  };
}
export function productForChoice(
  config: BillingConfig,
  choice: BillingChoice,
  provider: BillingProviderId = config.BILLING_DEFAULT_PROVIDER,
): string {
  const prefix = provider === "creem" ? "CREEM" : "POLAR";
  const tier = choice.tier === "plus" ? "PLUS" : "PRO";
  const interval = choice.interval === "month" ? "MONTHLY" : "YEARLY";
  return config[`${prefix}_${tier}_${interval}_PRODUCT_ID`];
}
export function choiceForProduct(
  config: BillingConfig,
  id: string,
  provider: BillingProviderId = config.BILLING_DEFAULT_PROVIDER,
): BillingChoice | null {
  if (!id) return null;
  for (const tier of ["plus", "pro"] as const)
    for (const interval of ["month", "year"] as const) {
      const choice = { tier, interval };
      if (productForChoice(config, choice, provider) === id) return choice;
    }
  return null;
}
