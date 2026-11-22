# Unified billing implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement these tasks in this session. Track each task with its verification result.

**Goal:** Route new subscriptions by country through a shared billing system, initially using Creem exclusively while retaining disabled Polar support.

**Architecture:** Provider adapters return normalized payment facts. Shared orchestration owns account locks, entitlements, checkout admission, and reconciliation. Provider identifiers scope all external identities and historical state.

**Tech stack:** TypeScript, Fastify, Drizzle, Postgres, Zod, Vitest, Next.js.

**Spec:** `docs/superpowers/specs/2026-11-17-unified-billing-design.md`

## Global constraints

- Creem enabled, Polar disabled, default provider Creem, no country overrides initially.
- Preserve existing prices, quotas, grace, and current-period refund/dispute policies.
- Never grant access from a redirect or create another payable checkout after an ambiguous outcome.
- No production deployment, live products, charges, or secrets in this implementation.
- Existing billing data belongs to Polar regardless of the new default.

## Review focus

- Same remote IDs at different providers must not collide or bind to another user.
- Concurrent requests for different providers must create only one intended subscription.
- Disabled Polar must make no network calls, including webhook and reconciliation paths.
- Missing checkout expiry must not be treated as expiration or permit a duplicate charge.
- Refunds, disputes, and stale events must not restore superseded paid access.

## Task 1: Provider configuration and routing

**Files:** `api/src/config/env.ts`, `api/src/modules/billing/{provider,routing,catalog,billing.schema,polar}.ts`, `api/tests/{env,billing.routing,billing.polar}.test.ts`.

**Interfaces:** Define `BillingProviderId = 'creem' | 'polar'`, a provider registry, provider-scoped product lookup, and `selectBillingProvider(config, country?)`. Retain internal choices `{tier, interval}`. Add optional `billingCountry` to checkout input independently of plan choices.

- [x] Write routing/config tests for the Creem default, country overrides, invalid country codes, disabled references, and enabled-provider credential validation.
- [x] Run tests and observe missing behavior.
- [x] Extract the provider contract, add per-provider settings, and implement routing and product mapping.
- [x] Run routing, env, and Polar adapter tests.

## Task 2: Provider-scoped persistence and shared orchestration

**Files:** `api/src/db/{schema.ts,migrations/*}`, `api/src/modules/billing/{sync,reconcile,billing.service,entitlements}.ts`, `api/tests/{billing.migration,billing.sync,billing.routes,billing.integration}.test.ts`, provider test helpers.

**Interfaces:** Keep `billing_customers` as account lock and aggregate snapshot. Add `billing_provider_customers` keyed by user/provider. Scope subscription/order/event/checkout keys by provider. Shared services consume the registry from Task 1 and provider-specific stored references.

- [x] Write populated migration and isolation tests, including duplicate remote IDs across providers.
- [x] Write checkout tests for cross-provider conflicts, unknown expiry, disabled provider management, and ambiguous creation recovery.
- [x] Observe failures, then migrate existing rows as Polar and update shared orchestration.
- [x] Preserve last verified access during outages and conflicts; never merge history from unrelated subscriptions or providers.
- [x] Run migration, sync, routes, entitlement, and integration tests.

## Task 3: Creem payments and signed webhooks

**Files:** `api/src/modules/billing/{creem,webhook.route,provider}.ts`, `api/src/server.ts`, `api/tests/{billing.creem,billing.webhook,billing.integration}.test.ts`.

**Interfaces:** Creem adapter implements the shared provider contract using verified persisted references. Signature parsing produces normalized minimal event evidence. Separate webhook routes share durable inbox handling.

- [x] Add adapter tests using documented HTTP payloads and signature tests over raw request bytes.
- [x] Observe failures, then implement checkout, direct state reads, transaction pagination, portal, and cancellation.
- [x] Bind initial checkout and subscription identity using the server-created attempt UUID and authenticated user UUID, never email.
- [x] Test paid-period grants, renewals, cancellation, refunds, disputes, malformed data, replay, and reordering.
- [x] Verify disabled Polar isolation and missed-event recovery through actual service/database tests.

## Task 4: Catalog audit, web integration, and operating documentation

**Files:** `api/scripts/check-billing-catalog.ts`, `api/.env.example`, `web/src/lib/billing.ts`, billing UI and tests, `docs/BILLING.md`, relevant deployment configuration.

**Interfaces:** Catalog exposes whether country is required. Country routing stays server-owned. Audit selects enabled providers and checks server-approved products through read-only calls.

- [x] Add failing tests for Creem product/tax/interval mismatch and country-required checkout behavior.
- [x] Implement provider-aware audit, optional country selection, and actionable billing conflicts.
- [x] Update configuration and launch/recovery instructions for Creem and disabled Polar.
- [x] Run API typecheck, lint, complete API suite, web typecheck, and affected web tests.

## Final verification and review

- [x] Inspect the complete diff for secrets, unrelated changes, and missing callers.
- [x] Dispatch one independent whole-change review, resolve material findings with regression tests, and rerun affected checks.
- [x] Commit validated changes on `feat/unified-billing` using Conventional Commits and repository commitlint.
- [x] Report actual checks and external launch requirements. Do not claim live payment verification.

## Execution record

The user approved implementation after the design review. Execute inline in the isolated checkout and use an independent reviewer at the end.

Implementation verification on 2026-11-17: complete API suite 598 passed, 5 skipped; complete web suite 206 passed. API and web typecheck passed. API ESLint and scoped billing web ESLint passed. Drizzle reported no remaining schema changes. Populated migration, concurrent checkout admission, disabled provider isolation, signature validation, historical refunds, and payment/dispute reordering are covered by the suites.

The independent review found conflict deadline advancement, unmatched dispute acknowledgement, and HTTP 502 outage isolation defects. Regression tests reproduced the first two, and the corrected outage path has an integration regression. All fixes passed focused and complete suites. Portal access during unrelated-provider outages and repurchase after a confirmed fully refunded cancellation also have regressions.

Ruling: run independent adapter, audit, and web changes in parallel with scoped file ownership. Shared persistence and orchestration remain with the primary implementer. Integration risk is checked by the complete suites and independent review.

Ruling: use validated Creem REST calls instead of adding its SDK. The documented endpoints need explicit ownership and ambiguity handling without automatic POST retries. Provider contract drift remains a live-integration verification requirement.

Ruling: maintain per-provider retry deadlines alongside the account lock. One provider's outage must not delay another provider's due reconciliation. Scheduling and retry regressions cover this change.

Ruling: a fully refunded subscription can be purchased again after confirmed cancellation. This preserves Polar's existing repurchase behavior while blocking a second subscription until remote renewal has stopped.

No live provider payments, products, public webhook delivery, production secret changes, or deployment were performed. Before enabling purchases, follow the external checks in `docs/BILLING.md`.
