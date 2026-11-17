import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { selectBillingProvider } from "../src/modules/billing/routing.js";

const base = {
  DATABASE_URL: "postgres://test",
  AGENT_API_URL: "http://test",
  JWT_SECRET: "test-secret-test-secret",
  ALTCHA_HMAC_KEY: "test-secret-test-secret",
};
const creem = {
  CREEM_API_KEY: "fixture",
  CREEM_WEBHOOK_SECRET: "fixture",
  CREEM_PLUS_MONTHLY_PRODUCT_ID: "prod_pm",
  CREEM_PLUS_YEARLY_PRODUCT_ID: "prod_py",
};

describe("provider routing", () => {
  it("uses Creem exclusively by default without Polar credentials", () => {
    const config = loadEnv({ ...base, ...creem, BILLING_ENABLED: "true" });
    expect(selectBillingProvider(config)).toBe("creem");
    expect(selectBillingProvider(config, "GE")).toBe("creem");
    expect(config.POLAR_ENABLED).toBe(false);
  });
  it("requires country only when routing overrides exist and never falls back", () => {
    const config = loadEnv({
      ...base,
      BILLING_COUNTRY_PROVIDERS: "IN=polar,KR=creem",
      POLAR_ENABLED: "true",
    });
    expect(selectBillingProvider(config, "IN")).toBe("polar");
    expect(selectBillingProvider(config, "KR")).toBe("creem");
    expect(selectBillingProvider(config, "GE")).toBe("creem");
    expect(() => selectBillingProvider(config)).toThrow("billing country");
  });
  it.each([
    "ZZ=creem",
    "IND=creem",
    "IN=unknown",
    "IN=polar",
    "IN=creem,IN=creem",
  ])("rejects invalid or disabled routes: %s", (value) => {
    expect(() =>
      loadEnv({ ...base, BILLING_COUNTRY_PROVIDERS: value }),
    ).toThrow();
  });
  it("does not require disabled Polar configuration", () => {
    expect(() =>
      loadEnv({
        ...base,
        ...creem,
        BILLING_ENABLED: "true",
        POLAR_ACCESS_TOKEN: "",
      }),
    ).not.toThrow();
    expect(() => loadEnv({ ...base, BILLING_ENABLED: "true" })).toThrow();
  });
});
