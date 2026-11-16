import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { buildPlanCatalog } from "../src/modules/billing/catalog.js";
import { deriveEntitlement } from "../src/modules/billing/entitlements.js";
import {
  planCatalogSchema,
  entitlementSchema,
  type BillingSnapshot,
} from "../src/modules/billing/billing.schema.js";
const config = () =>
  loadEnv({
    DATABASE_URL: "postgres://test",
    AGENT_API_URL: "http://test",
    JWT_SECRET: "test-secret-test-secret",
    ALTCHA_HMAC_KEY: "test-secret-test-secret",
  });
const period = {
  orderId: "order",
  productId: "plus-month",
  start: new Date("2026-10-10Z"),
  end: new Date("2026-11-10Z"),
  refundedAmount: 0,
  totalAmount: 900,
  dispute: "none" as const,
};
const snapshot = (
  overrides: Partial<Extract<BillingSnapshot, { kind: "subscription" }>> = {},
): BillingSnapshot => ({
  kind: "subscription",
  customerId: "customer",
  subscriptionId: "subscription",
  productId: "plus-month",
  choice: { tier: "plus", interval: "month" },
  status: "active",
  paidPeriod: period,
  orders: [period],
  cancelAtPeriodEnd: false,
  failedRenewal: false,
  revoked: false,
  pendingChange: null,
  ...overrides,
});
describe("billing entitlement policy", () => {
  it("publishes exact prices and all configured Free limits", () => {
    const catalog = buildPlanCatalog({
      ...config(),
      CUSTOM_SIMULATIONS_MAX: 4,
    });
    expect(
      catalog.plans
        .find((p) => p.tier === "plus")
        ?.prices.map((p) => p.amountCents),
    ).toEqual([900, 9000]);
    expect(
      catalog.plans
        .find((p) => p.tier === "pro")
        ?.prices.map((p) => p.amountCents),
    ).toEqual([4900, 49000]);
    expect(
      deriveEntitlement({ kind: "none" }, catalog, new Date()).limits
        .customSimulationsMax,
    ).toBe(4);
  });
  it("preserves zero Free inventory limits in public catalog and entitlement responses", () => {
    const catalog = buildPlanCatalog({
      ...config(),
      CUSTOM_SIMULATIONS_MAX: 0,
      CUSTOM_PERSONAS_MAX: 0,
    });
    expect(planCatalogSchema.safeParse(catalog).success).toBe(true);
    const entitlement = deriveEntitlement(
      { kind: "none" },
      catalog,
      new Date(),
    );
    expect(entitlementSchema.parse(entitlement).limits).toMatchObject({
      customSimulationsMax: 0,
      customPersonasMax: 0,
    });
  });
  it.each([
    {
      plusYearly: 12000,
      proYearly: 150000,
      plusDiscountLabel: "2 months free",
      proDiscountLabel: "2 months free",
    },
    {
      plusYearly: 14400,
      proYearly: 180000,
      plusDiscountLabel: null,
      proDiscountLabel: null,
    },
    {
      plusYearly: 12500,
      proYearly: 160000,
      plusDiscountLabel: null,
      proDiscountLabel: null,
    },
    {
      plusYearly: 12000,
      proYearly: 180000,
      plusDiscountLabel: "2 months free",
      proDiscountLabel: null,
    },
  ])(
    "publishes configured annual totals without an inaccurate discount: %j",
    ({
      plusYearly,
      proYearly,
      plusDiscountLabel,
      proDiscountLabel,
    }) => {
      const catalog = buildPlanCatalog({
        ...config(),
        PLUS_MONTHLY_PRICE_CENTS: 1200,
        PLUS_YEARLY_PRICE_CENTS: plusYearly,
        PRO_MONTHLY_PRICE_CENTS: 15000,
        PRO_YEARLY_PRICE_CENTS: proYearly,
      });
      expect(
        planCatalogSchema
          .parse(catalog)
          .plans.map(({ tier, prices }) => ({ tier, prices })),
      ).toEqual([
        { tier: "free", prices: [] },
        {
          tier: "plus",
          prices: [
            { interval: "month", amountCents: 1200, discountLabel: null },
            {
              interval: "year",
              amountCents: plusYearly,
              discountLabel: plusDiscountLabel,
            },
          ],
        },
        {
          tier: "pro",
          prices: [
            { interval: "month", amountCents: 15000, discountLabel: null },
            {
              interval: "year",
              amountCents: proYearly,
              discountLabel: proDiscountLabel,
            },
          ],
        },
      ]);
    },
  );
  it.each(["plus", "pro"] as const)(
    "uses the configured %s caps for both intervals",
    (tier) => {
      for (const interval of ["month", "year"] as const) {
        expect(
          deriveEntitlement(
            snapshot({ choice: { tier, interval } }),
            buildPlanCatalog(config()),
            new Date("2026-11-09Z"),
          ),
        ).toMatchObject({
          tier,
          limits:
            tier === "pro"
              ? {
                  sessionsCreateMax: 200,
                  chatMessagesMax: 6000,
                  customSimulationsMax: 500,
                  customPersonasMax: 500,
                  voiceDailyMinutes: 720,
                }
              : {
                  sessionsCreateMax: 100,
                  chatMessagesMax: 3000,
                  customSimulationsMax: 250,
                  customPersonasMax: 250,
                  voiceDailyMinutes: 360,
                },
          proAccess: tier === "pro",
        });
      }
    },
  );
  it("keeps Plus and Pro limit overrides independent", () => {
    const catalog = buildPlanCatalog({
      ...config(),
      PLUS_SESSIONS_CREATE_MAX: 120,
      PLUS_CHAT_MESSAGES_MAX: 3200,
      PLUS_CUSTOM_SIMULATIONS_MAX: 260,
      PLUS_CUSTOM_PERSONAS_MAX: 270,
      PLUS_VOICE_DAILY_MINUTES_PER_USER: 730,
      PRO_SESSIONS_CREATE_MAX: 210,
      PRO_CHAT_MESSAGES_MAX: 6200,
      PRO_CUSTOM_SIMULATIONS_MAX: 510,
      PRO_CUSTOM_PERSONAS_MAX: 520,
      PRO_VOICE_DAILY_MINUTES_PER_USER: 1450,
    });
    for (const interval of ["month", "year"] as const) {
      const now = new Date("2026-11-09Z");
      expect(
        deriveEntitlement(
          snapshot({ choice: { tier: "plus", interval } }),
          catalog,
          now,
        ).limits,
      ).toMatchObject({
        sessionsCreateMax: 120,
        chatMessagesMax: 3200,
        customSimulationsMax: 260,
        customPersonasMax: 270,
        voiceDailyMinutes: 730,
      });
      expect(
        deriveEntitlement(
          snapshot({ choice: { tier: "pro", interval } }),
          catalog,
          now,
        ).limits,
      ).toMatchObject({
        sessionsCreateMax: 210,
        chatMessagesMax: 6200,
        customSimulationsMax: 510,
        customPersonasMax: 520,
        voiceDailyMinutes: 1450,
        sessionsWindowMs: 21_600_000,
        chatWindowMs: 21_600_000,
      });
    }
  });
  it("grants 72 hours only after a failed renewal with proof of previous payment", () => {
    const catalog = buildPlanCatalog(config());
    expect(
      deriveEntitlement(
        snapshot({ failedRenewal: true }),
        catalog,
        new Date("2026-11-12Z"),
      ).reason,
    ).toBe("grace");
    expect(
      deriveEntitlement(
        snapshot({ failedRenewal: true }),
        catalog,
        new Date("2026-11-13Z"),
      ).tier,
    ).toBe("free");
    expect(
      deriveEntitlement(
        snapshot({ failedRenewal: true, paidPeriod: null, orders: [] }),
        catalog,
        new Date("2026-11-11Z"),
      ).tier,
    ).toBe("free");
    expect(
      deriveEntitlement(
        snapshot({ failedRenewal: true, cancelAtPeriodEnd: true }),
        catalog,
        new Date("2026-11-11Z"),
      ).tier,
    ).toBe("free");
  });
  it("suspends only current full refunds or unresolved disputes and uses provider annual boundaries", () => {
    const catalog = buildPlanCatalog(config());
    for (const dispute of ["open", "lost"] as const)
      expect(
        deriveEntitlement(
          snapshot({ paidPeriod: { ...period, dispute } }),
          catalog,
          new Date("2026-11-09Z"),
        ).tier,
      ).toBe("free");
    expect(
      deriveEntitlement(
        snapshot({ paidPeriod: { ...period, refundedAmount: 900 } }),
        catalog,
        new Date("2026-11-09Z"),
      ).reason,
    ).toBe("revoked");
    expect(
      deriveEntitlement(
        snapshot({
          paidPeriod: { ...period, refundedAmount: 100, dispute: "won" },
        }),
        catalog,
        new Date("2026-11-09Z"),
      ).tier,
    ).toBe("plus");
    expect(
      deriveEntitlement(
        snapshot({
          orders: [
            { ...period, orderId: "older", refundedAmount: 900 },
            period,
          ],
        }),
        catalog,
        new Date("2026-11-09Z"),
      ).tier,
    ).toBe("plus");
    expect(
      deriveEntitlement(
        snapshot({
          choice: { tier: "plus", interval: "year" },
          paidPeriod: { ...period, end: new Date("2028-02-29Z") },
        }),
        catalog,
        new Date("2028-02-28Z"),
      ).tier,
    ).toBe("plus");
  });
});
