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
        .find((p) => p.tier === "supporter")
        ?.prices.map((p) => p.amountCents),
    ).toEqual([10000, 100000]);
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
      proYearly: 12000,
      supporterYearly: 150000,
      proDiscountLabel: "2 months free",
      supporterDiscountLabel: "2 months free",
    },
    {
      proYearly: 14400,
      supporterYearly: 180000,
      proDiscountLabel: null,
      supporterDiscountLabel: null,
    },
    {
      proYearly: 12500,
      supporterYearly: 160000,
      proDiscountLabel: null,
      supporterDiscountLabel: null,
    },
    {
      proYearly: 12000,
      supporterYearly: 180000,
      proDiscountLabel: "2 months free",
      supporterDiscountLabel: null,
    },
  ])(
    "publishes configured annual totals without an inaccurate discount: %j",
    ({
      proYearly,
      supporterYearly,
      proDiscountLabel,
      supporterDiscountLabel,
    }) => {
      const catalog = buildPlanCatalog({
        ...config(),
        PRO_MONTHLY_PRICE_CENTS: 1200,
        PRO_YEARLY_PRICE_CENTS: proYearly,
        SUPPORTER_MONTHLY_PRICE_CENTS: 15000,
        SUPPORTER_YEARLY_PRICE_CENTS: supporterYearly,
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
              amountCents: proYearly,
              discountLabel: proDiscountLabel,
            },
          ],
        },
        {
          tier: "supporter",
          prices: [
            { interval: "month", amountCents: 15000, discountLabel: null },
            {
              interval: "year",
              amountCents: supporterYearly,
              discountLabel: supporterDiscountLabel,
            },
          ],
        },
      ]);
    },
  );
  it.each(["plus", "supporter"] as const)(
    "uses identical five paid caps for %s for both intervals",
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
          limits: {
            sessionsCreateMax: 100,
            chatMessagesMax: 3000,
            customSimulationsMax: 250,
            customPersonasMax: 250,
            voiceDailyMinutes: 720,
          },
          supporterAccess: tier === "supporter",
        });
      }
    },
  );
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
