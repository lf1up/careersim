import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

const baseEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/careersim",
  AGENT_API_URL: "http://localhost:8001",
  JWT_SECRET: "test-secret-test-secret-test-secret",
  ALTCHA_HMAC_KEY: "test-altcha-hmac-key-test-altcha-hmac-key",
};

describe("loadEnv", () => {
  it("requires an explicit supported provider to use its client-IP header", () => {
    expect(loadEnv(baseEnv).CLIENT_IP_SOURCE).toBe("socket");
    expect(
      loadEnv({ ...baseEnv, CLIENT_IP_SOURCE: "digitalocean" })
        .CLIENT_IP_SOURCE,
    ).toBe("digitalocean");
    expect(() =>
      loadEnv({ ...baseEnv, CLIENT_IP_SOURCE: "x-forwarded-for" }),
    ).toThrow(/CLIENT_IP_SOURCE/);
  });
  it("accepts only explicit IP addresses and CIDRs as trusted proxies", () => {
    expect(loadEnv(baseEnv).TRUSTED_PROXIES).toEqual([]);
    expect(
      loadEnv({
        ...baseEnv,
        TRUSTED_PROXIES: " 10.20.0.0/24, 2001:db8::/64,127.0.0.1 ",
      }).TRUSTED_PROXIES,
    ).toEqual(["10.20.0.0/24", "2001:db8::/64", "127.0.0.1"]);
    for (const value of [
      "true",
      "*",
      "https://proxy.example",
      "10.0.0.0/999",
    ]) {
      expect(() => loadEnv({ ...baseEnv, TRUSTED_PROXIES: value })).toThrow(
        /TRUSTED_PROXIES/,
      );
    }
  });
  it("defaults the text message allowance to 350 per six hours and accepts overrides", () => {
    expect(loadEnv(baseEnv)).toMatchObject({
      CHAT_MESSAGES_MAX: 350,
      CHAT_MESSAGES_WINDOW: "6 hours",
    });
    expect(
      loadEnv({
        ...baseEnv,
        CHAT_MESSAGES_MAX: "25",
        CHAT_MESSAGES_WINDOW: "30 minutes",
      }),
    ).toMatchObject({
      CHAT_MESSAGES_MAX: 25,
      CHAT_MESSAGES_WINDOW: "30 minutes",
    });
    expect(() => loadEnv({ ...baseEnv, CHAT_MESSAGES_MAX: "0" })).toThrow(
      /CHAT_MESSAGES_MAX/,
    );
    expect(() => loadEnv({ ...baseEnv, CHAT_MESSAGES_WINDOW: "" })).toThrow(
      /CHAT_MESSAGES_WINDOW/,
    );
  });
  it("allows local sender domains when SMTP is disabled", () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: "production",
      MAIL_FROM: "careersim.local <no-reply@careersim.local>",
    });

    expect(env.MAIL_FROM).toBe("careersim.local <no-reply@careersim.local>");
  });

  it("rejects local sender domains when production SMTP is enabled", () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: "production",
        SMTP_HOST: "smtp.resend.com",
        MAIL_FROM: "careersim.local <no-reply@careersim.local>",
      }),
    ).toThrow(/MAIL_FROM must use a verified sender domain/);
  });

  it("allows verified sender domains when production SMTP is enabled", () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: "production",
      SMTP_HOST: "smtp.resend.com",
      MAIL_FROM: "CareerSIM <no-reply@careersim.com>",
    });

    expect(env.MAIL_FROM).toBe("CareerSIM <no-reply@careersim.com>");
  });

  describe("API_VERSION_PREFIX", () => {
    it('means "no prefix" when unset or empty (bare-container / cloud default)', () => {
      expect(loadEnv(baseEnv).API_VERSION_PREFIX).toBe("");
      expect(
        loadEnv({ ...baseEnv, API_VERSION_PREFIX: "" }).API_VERSION_PREFIX,
      ).toBe("");
      expect(
        loadEnv({ ...baseEnv, API_VERSION_PREFIX: "  " }).API_VERSION_PREFIX,
      ).toBe("");
    });

    it("accepts bare numbers, v-prefixed values, and stray slashes equivalently", () => {
      expect(
        loadEnv({ ...baseEnv, API_VERSION_PREFIX: "1" }).API_VERSION_PREFIX,
      ).toBe("v1");
      expect(
        loadEnv({ ...baseEnv, API_VERSION_PREFIX: "v1" }).API_VERSION_PREFIX,
      ).toBe("v1");
      expect(
        loadEnv({ ...baseEnv, API_VERSION_PREFIX: "2" }).API_VERSION_PREFIX,
      ).toBe("v2");
      expect(
        loadEnv({ ...baseEnv, API_VERSION_PREFIX: "/V3/" }).API_VERSION_PREFIX,
      ).toBe("v3");
    });

    it("rejects values that are not a single path segment", () => {
      expect(() =>
        loadEnv({ ...baseEnv, API_VERSION_PREFIX: "v1/extra" }),
      ).toThrow(/API_VERSION_PREFIX/);
    });
  });

  it("requires a positive voice checkpoint lease and defaults to sixty seconds", () => {
    expect(loadEnv(baseEnv).VOICE_ACTIVE_CALL_STALE_SECONDS).toBe(60);
    expect(() =>
      loadEnv({ ...baseEnv, VOICE_ACTIVE_CALL_STALE_SECONDS: "0" }),
    ).toThrow(/VOICE_ACTIVE_CALL_STALE_SECONDS/);
  });

  describe("VOICE_WORKER_URL", () => {
    it("is empty by default", () => {
      expect(loadEnv(baseEnv).VOICE_WORKER_URL).toBe("");
    });

    it("accepts a URL", () => {
      expect(
        loadEnv({ ...baseEnv, VOICE_WORKER_URL: "http://agent-voice:8081" })
          .VOICE_WORKER_URL,
      ).toBe("http://agent-voice:8081");
    });

    it("rejects a non-URL", () => {
      expect(() =>
        loadEnv({ ...baseEnv, VOICE_WORKER_URL: "not-a-url" }),
      ).toThrow(/VOICE_WORKER_URL/);
    });
  });
});

describe("billing configuration", () => {
  const enabled = {
    ...baseEnv,
    BILLING_ENABLED: "true",
    POLAR_ACCESS_TOKEN: "test-token",
    POLAR_WEBHOOK_SECRET: "test-webhook",
    POLAR_PLUS_MONTHLY_PRODUCT_ID: "plus-month",
    POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-year",
  };
  it("defaults billing off and publishes requested finite paid caps with parsed windows", () => {
    expect(loadEnv(baseEnv)).toMatchObject({
      BILLING_ENABLED: false,
      SUPPORTER_CHECKOUT_ENABLED: false,
      POLAR_ENVIRONMENT: "sandbox",
      PRO_SESSIONS_CREATE_MAX: 100,
      PRO_CHAT_MESSAGES_MAX: 3000,
      PRO_CUSTOM_SIMULATIONS_MAX: 250,
      PRO_CUSTOM_PERSONAS_MAX: 250,
      PRO_VOICE_DAILY_MINUTES_PER_USER: 720,
      SESSIONS_CREATE_WINDOW_MS: 21_600_000,
      CHAT_MESSAGES_WINDOW_MS: 21_600_000,
    });
  });
  it("requires private keys and Plus products only when enabled", () => {
    expect(() => loadEnv({ ...baseEnv, BILLING_ENABLED: "true" })).toThrow(
      /POLAR_ACCESS_TOKEN/,
    );
    expect(loadEnv(enabled).BILLING_ENABLED).toBe(true);
  });
  it("requires Redis and quota enforcement for production billing", () => {
    expect(() => loadEnv({ ...enabled, NODE_ENV: "production" })).toThrow(
      /REDIS_URL/,
    );
    expect(() =>
      loadEnv({
        ...enabled,
        NODE_ENV: "production",
        REDIS_URL: "redis://localhost:6379",
        RATE_LIMIT_ENABLED: "false",
      }),
    ).toThrow(/RATE_LIMIT_ENABLED/);
    expect(
      loadEnv({
        ...enabled,
        NODE_ENV: "production",
        REDIS_URL: "redis://localhost:6379",
      }).BILLING_ENABLED,
    ).toBe(true);
    expect(
      loadEnv({ ...enabled, NODE_ENV: "test", RATE_LIMIT_ENABLED: "false" })
        .BILLING_ENABLED,
    ).toBe(true);
  });
  it("retains production quota requirements when new purchases are disabled but billing is configured", () => {
    const closed = {
      ...enabled,
      BILLING_ENABLED: "false",
      NODE_ENV: "production",
    };
    expect(() => loadEnv(closed)).toThrow(/REDIS_URL/);
    expect(() =>
      loadEnv({
        ...closed,
        REDIS_URL: "redis://localhost:6379",
        RATE_LIMIT_ENABLED: "false",
      }),
    ).toThrow(/RATE_LIMIT_ENABLED/);
    expect(() =>
      loadEnv({
        ...closed,
        REDIS_URL: "redis://localhost:6379",
        VOICE_DAILY_MINUTES_PER_USER: "0",
      }),
    ).toThrow(/PRO_VOICE_DAILY_MINUTES_PER_USER/);
    expect(
      loadEnv({
        ...baseEnv,
        NODE_ENV: "production",
        VOICE_DAILY_MINUTES_PER_USER: "0",
      }).BILLING_ENABLED,
    ).toBe(false);
  });
  it("requires both Supporter products and private channel behind the explicit launch gate", () => {
    expect(() =>
      loadEnv({ ...enabled, SUPPORTER_CHECKOUT_ENABLED: "true" }),
    ).toThrow(/SUPPORTER_CHANNEL_URL/);
    expect(
      loadEnv({
        ...enabled,
        SUPPORTER_CHECKOUT_ENABLED: "true",
        SUPPORTER_CHANNEL_URL: "https://private.example/channel",
        POLAR_SUPPORTER_MONTHLY_PRODUCT_ID: "supporter-month",
        POLAR_SUPPORTER_YEARLY_PRODUCT_ID: "supporter-year",
      }).SUPPORTER_CHECKOUT_ENABLED,
    ).toBe(true);
  });
  it("rejects duplicate products, unsafe paid integers, lower paid caps and unlimited Free voice with billing enabled", () => {
    expect(() =>
      loadEnv({ ...enabled, POLAR_PLUS_YEARLY_PRODUCT_ID: "plus-month" }),
    ).toThrow(/unique/);
    for (const value of ["0", "-1", "1.5", "9007199254740992"])
      expect(() =>
        loadEnv({ ...baseEnv, PRO_CHAT_MESSAGES_MAX: value }),
      ).toThrow(/PRO_CHAT_MESSAGES_MAX/);
    expect(() => loadEnv({ ...baseEnv, SESSIONS_CREATE_MAX: "101" })).toThrow(
      /PRO_SESSIONS_CREATE_MAX/,
    );
    expect(() =>
      loadEnv({ ...enabled, VOICE_DAILY_MINUTES_PER_USER: "0" }),
    ).toThrow(/PRO_VOICE_DAILY_MINUTES_PER_USER/);
  });
  it("rejects ambiguous durations and accepts explicit non-default windows", () => {
    for (const value of [
      "1 month",
      "6 monkeys",
      "tomorrow",
      "0",
      "-1 hour",
      "",
    ])
      expect(() =>
        loadEnv({ ...baseEnv, CHAT_MESSAGES_WINDOW: value }),
      ).toThrow(/CHAT_MESSAGES_WINDOW/);
    expect(
      loadEnv({
        ...baseEnv,
        SESSIONS_CREATE_WINDOW: "90 minutes",
        CHAT_MESSAGES_WINDOW: "1800000",
      }),
    ).toMatchObject({
      SESSIONS_CREATE_WINDOW_MS: 5_400_000,
      CHAT_MESSAGES_WINDOW_MS: 1_800_000,
    });
  });
});
