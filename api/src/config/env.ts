import { z } from "zod";
import ms from "ms";

import { parseCorsAllowedOrigins } from "../utils/cors.js";

/**
 * Normalize `API_VERSION_PREFIX` into the path segment versioned routes
 * are served under. Empty/unset means NO prefix — a bare container (the
 * current cloud setup) serves `/auth/...`, etc. When set, `1`, `v1`, and
 * `/v1/` are accepted equivalently and normalize to the segment `v1`;
 * the leading slash is added where the prefix is applied (server.ts).
 * The local compose stack and `.env` set `v1` explicitly, matching the
 * `/v1` path in the web app's NEXT_PUBLIC_API_URL.
 *
 * Process liveness (`GET /health`) is always unprefixed, regardless of
 * this value. The versioned readiness probe lives at `{prefix}/health`.
 */
function normalizeVersionPrefix(raw: string, ctx: z.RefinementCtx): string {
  const stripped = raw
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (stripped === "") return "";
  const segment = stripped.startsWith("v") ? stripped : `v${stripped}`;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(segment)) {
    ctx.addIssue({
      code: "custom",
      message: `API_VERSION_PREFIX must be a single path segment (got "${raw}")`,
    });
    return z.NEVER;
  }
  return segment;
}

const positiveLimit = z.coerce.number().int().positive().max(2_147_483_647);
const bool = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");
/** Only explicit millisecond numbers or a number with an unambiguous unit. */
export function parseBillingWindow(value: string): number {
  if (
    !/^\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|seconds?|m|minutes?|h|hours?|d|days?|w|weeks?)?$/i.test(
      value.trim(),
    )
  )
    throw new Error(
      "Duration must use an explicit supported unit or milliseconds",
    );
  const parsed = /^\d+$/.test(value.trim())
    ? Number(value)
    : ms(value as ms.StringValue);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647)
    throw new Error("Duration must be a positive safe number of milliseconds");
  return parsed;
}
const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().default(8000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    CLIENT_IP_SOURCE: z.enum(["socket", "digitalocean"]).default("socket"),
    TRUSTED_PROXIES: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]))),

    // Version segment prefixed to versioned routes (service index,
    // readiness health, docs, auth, sessions, analytics, voice —
    // internal worker routes included). Empty/unset means NO prefix
    // (the bare-container / cloud default). Process liveness at
    // `GET /health` is never prefixed. Local dev + compose set `v1`;
    // the web app's NEXT_PUBLIC_API_URL must carry the same path (it's
    // a full base URL) and the agent-voice worker reads the same env
    // var name.
    API_VERSION_PREFIX: z
      .string()
      .default("")
      .transform(normalizeVersionPrefix),

    DATABASE_URL: z.string().min(1),

    AGENT_API_URL: z.string().url(),

    // Shared secret sent as `X-Internal-Key` on every API ⇒ agent call.
    // Must match `AGENT_INTERNAL_KEY` on the agent side (see
    // agent/src/careersim_agent/config.py). When empty we still start —
    // the agent runs in "dev mode" and accepts unauthenticated calls —
    // but production deployments MUST set this to a long random string.
    AGENT_INTERNAL_KEY: z.string().default(""),

    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    JWT_EXPIRES_IN: z.string().default("7d"),

    // URL of the Next.js web app; embedded in magic-link and password-reset
    // emails so the links point at the correct origin per environment.
    WEB_APP_URL: z.string().url().default("http://localhost:3000"),

    // Comma-separated browser origins allowed by CORS. Leave empty to keep
    // Fastify's current wide-open CORS behavior for local/dev deployments.
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default("")
      .transform(parseCorsAllowedOrigins),

    // Outbound email. When SMTP_HOST is empty we log rendered emails to the
    // Fastify logger instead of sending (useful in dev / Vitest).
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z
      .string()
      .default("false")
      .transform((v) => v === "true" || v === "1"),
    SMTP_USER: z.string().default(""),
    SMTP_PASS: z.string().default(""),
    MAIL_FROM: z.string().default("careersim.local <no-reply@careersim.local>"),
    MAIL_PRODUCT_NAME: z.string().default("careersim.local"),

    // HMAC secret for ALTCHA proof-of-work challenges. Must be kept secret
    // server-side — the widget never sees it. Rotating invalidates any
    // in-flight challenges. 32+ chars recommended.
    ALTCHA_HMAC_KEY: z
      .string()
      .min(16, "ALTCHA_HMAC_KEY must be at least 16 characters"),
    // Upper bound for the random PoW target. Higher = slower solve. The default
    // (~50k) typically solves in well under a second on modern hardware.
    ALTCHA_MAX_NUMBER: z.coerce.number().int().positive().default(50_000),

    // ------------------------------------------------------------------
    // Rate limiting (@fastify/rate-limit)
    //
    // `RATE_LIMIT_ENABLED=false` disables the plugin entirely (useful in
    // integration tests, load tests, or during incidents where the limit
    // is itself an availability issue). When enabled and REDIS_URL is
    // set, buckets live in Redis so horizontally-scaled API instances
    // share state; otherwise they fall back to per-process LRU memory
    // (fine for a single-instance deploy).
    // ------------------------------------------------------------------
    RATE_LIMIT_ENABLED: z
      .string()
      .default("true")
      .transform((v) => v !== "false" && v !== "0"),
    REDIS_URL: z.string().default(""),

    // Per-user cap on creating new chat sessions. We keep this aggressive by
    // default (2 per 6 hours) because each session spins up an agent thread
    // and consumes LLM tokens; a sustained burst from one account is almost
    // always abuse or a runaway client, not legitimate use. Ops can loosen
    // these per environment without code changes.
    //
    // The window accepts anything `@fastify/rate-limit` understands: a
    // string like '1 hour' / '30 minutes' / '6 hours', or a number of ms.
    SESSIONS_CREATE_MAX: z.coerce.number().int().positive().default(2),
    SESSIONS_CREATE_WINDOW: z.string().default("6 hours"),

    // Shared text-message allowance across simulations and creator playgrounds.
    CHAT_MESSAGES_MAX: z.coerce.number().int().positive().default(350),
    CHAT_MESSAGES_WINDOW: z.string().trim().min(1).default("6 hours"),

    CUSTOM_SIMULATIONS_MAX: positiveLimit.default(3),
    CUSTOM_PERSONAS_MAX: positiveLimit.default(10),
    PRO_SESSIONS_CREATE_MAX: positiveLimit.default(100),
    PRO_CHAT_MESSAGES_MAX: positiveLimit.default(3000),
    PRO_CUSTOM_SIMULATIONS_MAX: positiveLimit.default(250),
    PRO_CUSTOM_PERSONAS_MAX: positiveLimit.default(250),
    PRO_VOICE_DAILY_MINUTES_PER_USER: positiveLimit
      .max(35_791_394)
      .default(720),
    BILLING_ENABLED: bool,
    POLAR_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
    POLAR_ACCESS_TOKEN: z.string().default(""),
    POLAR_WEBHOOK_SECRET: z.string().default(""),
    POLAR_PLUS_MONTHLY_PRODUCT_ID: z.string().default(""),
    POLAR_PLUS_YEARLY_PRODUCT_ID: z.string().default(""),
    POLAR_SUPPORTER_MONTHLY_PRODUCT_ID: z.string().default(""),
    POLAR_SUPPORTER_YEARLY_PRODUCT_ID: z.string().default(""),
    SUPPORTER_CHECKOUT_ENABLED: bool,
    SUPPORTER_CHANNEL_URL: z.union([z.literal(""), z.url()]).default(""),
    BILLING_CONTACT_URL: z
      .string()
      .regex(/^\/(?!\/)/)
      .default("/contact"),

    // ------------------------------------------------------------------
    // Voice mode (browser-native LiveKit + chained pipeline)
    //
    // `VOICE_ENABLED=false` is the kill switch — voice routes register
    // unconditionally so the OpenAPI surface is stable, but they
    // return `503 voice_disabled` until the flag is flipped on. Mirrors
    // the agent-side `VOICE_ENABLED` so both should usually be flipped
    // together.
    //
    // `LIVEKIT_*` is the self-hosted SFU's signalling URL + key/secret
    // pair used to mint short-lived join tokens for the web client.
    // The defaults match `docker-compose.local.yml`.
    //
    // `VOICE_DAILY_MINUTES_PER_USER` is the per-user-per-day quota
    // enforced by the `voice_minute_usage` table; layered on top of
    // the `voiceStart` rate-limit policy.
    // ------------------------------------------------------------------
    VOICE_ENABLED: z
      .string()
      .default("false")
      .transform((v) => v !== "false" && v !== "0"),
    LIVEKIT_URL: z.string().default(""),
    LIVEKIT_API_KEY: z.string().default(""),
    LIVEKIT_API_SECRET: z.string().default(""),
    VOICE_DAILY_MINUTES_PER_USER: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60),
    // A call keeps its single-active-call lease through duration checkpoints.
    // After this positive interval without a checkpoint, assume the worker
    // crashed and allow a fresh call. Default 60 seconds; credential lifetime
    // remains independent of this lease and of the daily allowance.
    VOICE_ACTIVE_CALL_STALE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60),
    // LiveKit Agents worker HTTP health (GET `/` on host:port, default
    // 8081). Empty → versioned `/health` reports `voice: skipped`.
    // Only probed when VOICE_ENABLED is true.
    VOICE_WORKER_URL: z
      .string()
      .default("")
      .transform((v, ctx) => {
        const trimmed = v.trim();
        if (!trimmed) return "";
        if (!URL.canParse(trimmed)) {
          ctx.addIssue({
            code: "custom",
            message: "VOICE_WORKER_URL must be a valid URL",
          });
          return z.NEVER;
        }
        return trimmed;
      }),
  })
  .superRefine((env, ctx) => {
    for (const key of [
      "SESSIONS_CREATE_WINDOW",
      "CHAT_MESSAGES_WINDOW",
    ] as const) {
      try {
        parseBillingWindow(env[key]);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Invalid or ambiguous duration",
        });
      }
    }
    const products = [
      "POLAR_PLUS_MONTHLY_PRODUCT_ID",
      "POLAR_PLUS_YEARLY_PRODUCT_ID",
      "POLAR_SUPPORTER_MONTHLY_PRODUCT_ID",
      "POLAR_SUPPORTER_YEARLY_PRODUCT_ID",
    ] as const;
    const billingConfigured =
      env.BILLING_ENABLED ||
      Boolean(env.POLAR_ACCESS_TOKEN) ||
      products.some((key) => Boolean(env[key]));
    const pairs = [
      ["PRO_SESSIONS_CREATE_MAX", "SESSIONS_CREATE_MAX"],
      ["PRO_CHAT_MESSAGES_MAX", "CHAT_MESSAGES_MAX"],
      ["PRO_CUSTOM_SIMULATIONS_MAX", "CUSTOM_SIMULATIONS_MAX"],
      ["PRO_CUSTOM_PERSONAS_MAX", "CUSTOM_PERSONAS_MAX"],
      ["PRO_VOICE_DAILY_MINUTES_PER_USER", "VOICE_DAILY_MINUTES_PER_USER"],
    ] as const;
    for (const [paid, free] of pairs)
      if (
        env[paid] < env[free] ||
        (billingConfigured &&
          free === "VOICE_DAILY_MINUTES_PER_USER" &&
          env[free] === 0)
      )
        ctx.addIssue({
          code: "custom",
          path: [paid],
          message: `Paid caps must be at least the finite Free cap (${free})`,
        });
    if (env.NODE_ENV === "production" && billingConfigured) {
      if (!env.REDIS_URL.trim())
        ctx.addIssue({
          code: "custom",
          path: ["REDIS_URL"],
          message: "Required for production billing quota enforcement",
        });
      if (!env.RATE_LIMIT_ENABLED)
        ctx.addIssue({
          code: "custom",
          path: ["RATE_LIMIT_ENABLED"],
          message: "Must be enabled for production billing quota enforcement",
        });
    }
    const configured = products.map((k) => env[k]).filter(Boolean);
    if (new Set(configured).size !== configured.length)
      ctx.addIssue({
        code: "custom",
        path: ["POLAR_PLUS_MONTHLY_PRODUCT_ID"],
        message: "Product IDs must be unique",
      });
    const required = env.BILLING_ENABLED
      ? ([
          "POLAR_ACCESS_TOKEN",
          "POLAR_WEBHOOK_SECRET",
          ...products.slice(0, 2),
        ] as const)
      : [];
    for (const key of required)
      if (!env[key])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Required when billing is enabled",
        });
    if (env.SUPPORTER_CHECKOUT_ENABLED) {
      if (!env.BILLING_ENABLED)
        ctx.addIssue({
          code: "custom",
          path: ["SUPPORTER_CHECKOUT_ENABLED"],
          message: "Requires billing enabled",
        });
      for (const key of [
        "POLAR_SUPPORTER_MONTHLY_PRODUCT_ID",
        "POLAR_SUPPORTER_YEARLY_PRODUCT_ID",
        "SUPPORTER_CHANNEL_URL",
      ] as const)
        if (!env[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required when Supporter checkout is enabled",
          });
    }
    if (
      env.NODE_ENV === "production" &&
      env.SMTP_HOST &&
      /@[^>\s]*\.local(?:[>\s]|$)/i.test(env.MAIL_FROM)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_FROM"],
        message:
          "MAIL_FROM must use a verified sender domain when SMTP is enabled in production",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema> & {
  SESSIONS_CREATE_WINDOW_MS: number;
  CHAT_MESSAGES_WINDOW_MS: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${errors}`);
  }
  return {
    ...parsed.data,
    SESSIONS_CREATE_WINDOW_MS: parseBillingWindow(
      parsed.data.SESSIONS_CREATE_WINDOW,
    ),
    CHAT_MESSAGES_WINDOW_MS: parseBillingWindow(
      parsed.data.CHAT_MESSAGES_WINDOW,
    ),
  };
}
