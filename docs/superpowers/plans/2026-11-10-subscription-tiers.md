# Subscription Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce Free, Plus, and Supporter subscriptions with Polar monthly/yearly checkout, visible allowances, and the approved Supporter benefits.

**Architecture:** The Fastify API owns billing state and resolves per-user entitlements. Existing Redis request counters, Postgres voice accounting, and the creator plugin consume those entitlements. Next.js renders one public pricing catalog and authenticated billing/support screens; Polar collects payments and hosts payment management.

**Tech Stack:** TypeScript, Fastify 5, Drizzle/Postgres, Redis/ioredis, Next.js 16/React, Python/LiveKit, Polar TypeScript SDK, Vitest/PGlite, pytest.

**Spec:** `docs/superpowers/specs/2026-11-10-subscription-tiers-design.md`, approved 2026-11-10. Read the full spec before executing.

## Global Constraints

- Exactly three tiers: `free`, `plus`, `supporter`; both paid tiers use the same `PRO_` caps. No fourth Pro tier.
- Plus: $9/month or $90/year upfront. Supporter: $100/month or $1,000/year upfront. Annual discount: "2 months free", 16.67%; yearly auto-renewal disclosed.
- `PRO_SESSIONS_CREATE_MAX=100`, `PRO_CHAT_MESSAGES_MAX=3000`, `PRO_CUSTOM_SIMULATIONS_MAX=250`, `PRO_CUSTOM_PERSONAS_MAX=250`, `PRO_VOICE_DAILY_MINUTES_PER_USER=720`.
- Preserve unprefixed Free settings and the configured session/message windows, currently 6 hours. Voice resets at midnight UTC. Custom records are owned, non-deleted inventory, not monthly credits.
- Pricing visibly lists all five caps, core benefits, and "Need higher limits? Contact us to discuss your needs."
- Supporter benefit copy: "Guidance and support from the development team"; "Chat directly with the developers"; "Help decide the project's future together".
- No tokens, packs, donations, trials, automatic overages, or new voting/community platform. No application code in deprecated `backend/` or `frontend/`.
- Preserve safety rate limits, ownership checks, moderation, and saved content after downgrade. Annual billing never multiplies or resets usage allowances.
- Supporter purchase remains disabled for both intervals until Polar accepts the actual offer and a contact channel is configured. This gate applies to checkout and plan changes, not just UI.
- Preserve the approved three-day failed-renewal grace and cancellation/refund/dispute policies in the spec. Cancellation alone never receives grace.
- The current workspace authorizes planning. Execution must arrange writable checkouts for both repositories; do not modify generated plugin copies or write into the sibling repository without filesystem authorization. If needed, prepare an isolated writable checkout within an allowed root and coordinate its commit with the host.
- Use existing per-package package-manager versions. API and studio require Node >=22.12.0; use a compatible Node runtime throughout. Do not introduce an unrelated dependency upgrade.
- A task's commit step stages only its files, in its own repository, if git writes are available. Do not stage user changes. Never deploy, publish products, charge customers, send invitations, or contact Polar during implementation without the corresponding authorization.

## Review Focus

1. Historical refund delivered after a newer paid renewal must not remove newer access. Task 2 tests this and reversed event order.
2. Two tabs buying different intervals must not create overlapping subscriptions. Task 3 tests pending-checkout reuse, conflict, and recovery after a timeout.
3. A batch larger than remaining quota must consume nothing; upgrading/downgrading must reuse the same counters. Task 4 tests both, including two real Redis clients.
4. A call crossing UTC midnight or losing its worker must retain bounded, deduplicated usage. Task 6 tests clock boundaries, replay, and outage cutoff.
5. Pricing with non-default windows and a personal contact request without a company must work. Tasks 7 and 8 test those inputs and preserve business-form validation.

## File and interface map

Paths are relative to `/Users/lf1up/Projects/careersim` unless prefixed `studio:`. `studio:` means the source checkout of `lf1up/careersim-studio`, not installed overlays.

| Unit | Files | Responsibility |
| --- | --- | --- |
| Contracts/catalog | `api/src/modules/billing/billing.schema.ts`, `catalog.ts`, `api/src/config/env.ts` | Validated plans, prices, public limits and billing choices |
| Persistence/access | `api/src/db/schema.ts`, generated migrations, `billing/entitlements.ts` | Provider facts and time-bounded per-user entitlements |
| Polar adapter | `billing/polar.ts`, `billing/sync.ts`, `billing/webhook.route.ts`, `billing/reconcile.ts` | SDK boundary, signed events, authoritative synchronization |
| Billing API | `billing/billing.service.ts`, `billing/billing.route.ts`, `api/src/server.ts`, `api/src/index.ts` | Catalog, checkout, account, portal, scheduled changes |
| Request quotas | `api/src/modules/quotas/window-quota.ts`, `api/src/plugins/rate-limit.ts` | Atomic count-at-acceptance with dynamic ceilings |
| Creator | `api/src/extensions/sdk.ts`, `studio:plugins/creator/api/*`, `studio:plugins/creator/shared/limits.ts` | One host resolver for inventory and playground quotas |
| Voice | `api/src/modules/voice/*`, new `voice-usage.ts`, `agent/src/careersim_agent/voice/{worker.py,state_bridge.py}` | Call identity, checkpoints, daily budgets and cutoff |
| Pricing | `web/src/app/(public)/pricing/page.tsx`, `web/src/components/billing/PricingPage.tsx`, `web/src/lib/billing.ts` | Public catalog and monthly/yearly comparison |
| Account/contact | `web/src/components/billing/BillingPanel.tsx`, `web/src/app/(public)/contact/page.tsx`, existing contact API | Account lifecycle, Supporter access and personal contact |
| Operations | `docs/BILLING.md`, env examples, `VOICE_MODE.md`, CI | Sandbox evidence, migration order, flags and recovery |

Tasks are sequential where contracts depend on earlier work: 1 → 2 → 3; 1 → 4 → 5; 1 → 6; 3/4/5/6 → 7/8 → 9. Keep these in one coordinated plan because they share entitlement contracts and must launch together. Each task nevertheless has its own testable deliverable.

## Task 1: Plan catalog, persisted billing facts and entitlement resolution

**Files:** Create `api/src/modules/billing/{billing.schema.ts,catalog.ts,entitlements.ts}` and `api/tests/billing.entitlements.test.ts`; modify `api/src/config/env.ts`, `api/src/db/schema.ts`, `api/.env.example`, `api/tests/env.test.ts`. Generate a new Drizzle migration and metadata; the next unused migration number is authoritative at execution time.

**Interfaces:** Define and export schema-derived `Tier`, `PaidTier`, `BillingInterval`, `BillingChoice`, `PlanLimits`, `PlanCatalog`, `BillingSnapshot`, `Entitlement`, and `BillingAccount` from `billing.schema.ts`.

- `Tier = 'free' | 'plus' | 'supporter'`, `PaidTier` excludes Free, interval is `'month' | 'year'`, choice is `{ tier: PaidTier; interval: BillingInterval }`.
- `PlanLimits` fields: `sessionsCreateMax`, `sessionsWindowMs`, `chatMessagesMax`, `chatWindowMs`, `customSimulationsMax`, `customPersonasMax`, `voiceDailyMinutes`.
- `PlanCatalog` contains three public plans, limits, benefit strings, USD prices in integer cents, interval, contact URL, and a typed availability state. No product IDs, channel URLs, secrets or environment names in the public response.
- `BillingSnapshot` is normalized provider evidence: recognized choice, paid period start/end and order ID, cancellation, failed renewal, pending choice/effective time, and explicit refund/revocation/dispute state. Separate no-subscription and paid variants; do not derive paid access from an unverified active status.
- `Entitlement` has `tier`, `limits`, `supporterAccess`, and a discriminated access reason (`free`, `paid`, `grace`, `expired`, `revoked`, `disputed`). `BillingAccount` adds interval, paid-through, renewal/cancellation, pending change and usage, without exposing private provider payloads.
- `buildPlanCatalog(config: BillingConfig): PlanCatalog`, `deriveEntitlement(snapshot: BillingSnapshot, catalog: PlanCatalog, now: Date): Entitlement`, `resolveEntitlements(userId: string): Promise<Entitlement>` from a `createEntitlementService({db, catalog, now})` factory. `BillingConfig` is derived from the validated env schema.

- [ ] Write `billing.entitlements.test.ts` using a real PGlite DB and fixed clock. Assert both paid tiers and both intervals resolve to the five approved caps; Free reads overridden configuration. At paid-through + 72 hours a failed renewal becomes Free, while voluntary cancellation becomes Free at paid-through. Initial unpaid access has no grace. Historical refund does not touch a newer paid period.

```ts
expect(paid.limits).toMatchObject({ sessionsCreateMax: 100, chatMessagesMax: 3000,
  customSimulationsMax: 250, customPersonasMax: 250, voiceDailyMinutes: 720 });
expect(catalog.plans.find(p => p.tier === 'plus')?.prices.map(p => p.amountCents))
  .toEqual([900, 9000]);
expect(catalog.plans.find(p => p.tier === 'supporter')?.prices.map(p => p.amountCents))
  .toEqual([10000, 100000]);
```

- [ ] Run `pnpm -C api test -- tests/billing.entitlements.test.ts tests/env.test.ts`; confirm new cases fail for missing contracts, not infrastructure errors.
- [ ] Add validated config: five requested `PRO_` defaults, Free creator limits, `BILLING_ENABLED=false`, `POLAR_ENVIRONMENT=sandbox`, private access/webhook secrets, four `POLAR_{PLUS,SUPPORTER}_{MONTHLY,YEARLY}_PRODUCT_ID` values, `SUPPORTER_CHECKOUT_ENABLED=false`, `SUPPORTER_CHANNEL_URL`, and contact URL `/contact`. Require secrets/Plus products only when billing is enabled; require Supporter products/channel only when its launch flag is enabled. Reject duplicate product IDs and paid caps below Free. Parse window durations once using the project's installed duration dependency, declaring it directly if necessary; reject ambiguous durations.
- [ ] Create tables for unique user/customer binding, provider subscriptions, paid orders with their periods/refunds, webhook inbox with unique provider event ID, and checkout attempts. Unique provider IDs and indexes support account lookup and pending reconciliation. Preserve unknown provider products for diagnosis without granting access. Generate migration via `pnpm -C api db:generate`; inspect SQL and journal, and run it against existing and empty test databases.
- [ ] Implement catalog and resolver. Only normalized verified evidence can grant access; no row means Free, DB failure propagates as a service error. Do not store tier in JWTs or grant trial access. Use provider period timestamps, including leap-year annual periods.
- [ ] Run the focused tests and `pnpm -C api typecheck`; expect PASS. Commit task files: `feat: define subscription catalog and entitlements`.

## Task 2: Polar verification, synchronization and reconciliation

**Files:** Create `api/src/modules/billing/{polar.ts,sync.ts,webhook.route.ts,reconcile.ts}`, `api/tests/{billing.sync.test.ts,billing.webhook.test.ts}`, `api/tests/helpers/fake-billing-provider.ts`; modify `api/package.json`, its lockfile, `api/src/server.ts`, `api/src/index.ts` and test-app factory.

**Interfaces:** `BillingProvider` in `polar.ts` exposes `fetchSnapshot(userId: string): Promise<BillingSnapshot>`, `createCheckout({userId, choice, attemptId}): Promise<{id:string; url:string; expiresAt:Date}>`, `findCheckout(attemptId: string): Promise<checkout|null>`, `createPortal(userId: string): Promise<{url:string}>`, `scheduleChange({subscriptionId, choice}): Promise<void>`, and `revokeSubscription(subscriptionId: string): Promise<void>`. Here `checkout` means the same return type as `createCheckout`, derived with `Awaited<ReturnType<...>>`. SDK response types stay within this adapter. `syncCustomer({userId, reason}): Promise<void>` and `reconcileBilling({limit:number}): Promise<{processed:number; failed:number}>` come from injected factories.

- [ ] Add PGlite integration cases for duplicate signed event delivery, forged signatures, failed processing followed by retry, reordered events, annual renewal, initial unpaid checkout, unknown product, older-period refund, current full/partial refund, open/lost/won dispute, immediate revocation, grace expiry, and missed webhook recovered by reconciliation. Use a deterministic `FakeBillingProvider` implementing the interface; use the SDK verifier with real test signatures instead of mocking signature verification.

```ts
expect(inboxRowsForRepeatedEvent).toHaveLength(1);
expect(entitlementAfterOlderRefund.tier).toBe('plus');
expect(entitlementAfterCurrentDispute.tier).toBe('free');
expect(forgedResponse.statusCode).toBe(403);
expect(snapshotAfterRenewalFailure.paidThrough).toEqual(previousPaidThrough);
```

- [ ] Run `pnpm -C api test -- tests/billing.sync.test.ts tests/billing.webhook.test.ts`; confirm new tests fail.
- [ ] Install a compatible current `@polar-sh/sdk` version and pin the selected API version in the adapter. Docs checked during planning use `@polar-sh/sdk/2026-10` and `webhooks.validateEvent`. Validate actual SDK exports before implementation; use the SDK's signature parser on untouched request bytes and Standard Webhooks headers. Register a scoped raw-body parser for `/billing/webhook` without changing unrelated JSON parsing. Authenticate this endpoint by signature, not browser cookies or CAPTCHA; apply a distinct ingress rate policy.
- [ ] Store verified deliveries idempotently, then synchronize authoritative state under a per-customer DB lock acquired before fetching the snapshot. Acknowledged inbox records must remain retryable until synchronized. Fetch payment evidence as well as customer/subscription state: `order.paid` is proof of received payment; `subscription.cycled` is not. Record pending revocation work after a full current-period refund and retry the provider mutation safely. Do not let snapshot refresh erase unresolved dispute evidence.
- [ ] Run reconciliation every five minutes, with bounded batches, overlap protection, and shutdown cleanup. Retry pending deliveries and side effects; refresh active/grace subscriptions and pending checkouts. Log correlation IDs and counts without raw secrets or full payloads. Late events trigger a fresh fetch, never a stale overwrite. Do not extend stored paid-through on a provider timeout.
- [ ] Run focused tests and `pnpm -C api typecheck`; expect PASS. Commit: `feat: synchronize verified Polar billing state`.

## Task 3: Checkout, account, portal and scheduled plan changes

**Files:** Create `api/src/modules/billing/{billing.service.ts,billing.route.ts}` and `api/tests/billing.routes.test.ts`; extend `billing.schema.ts`, `server.ts`, `index.ts`, `api/src/extensions/sdk.ts`, `api/scripts/plugins.mjs`, `web/scripts/plugins.mjs` and test factory.

**Interfaces:** Routes under the configured API version prefix: `GET /billing/catalog` public, `GET /billing/account` authenticated, `POST /billing/checkout` with `BillingChoice`, `POST /billing/refresh`, `POST /billing/portal`, `POST /billing/change` with `BillingChoice`, `GET /billing/supporter` authenticated. `createBillingService` provides corresponding `getAccount(userId): Promise<BillingAccount>`, `startCheckout({userId,choice})`, `refresh(userId)`, `portal(userId)`, `scheduleChange({userId,choice})`, and `supporterAccess(userId): Promise<{channelUrl:string; instructions:string}>` methods; checkout and portal return `{url:string}`, refresh returns `BillingAccount`, change returns pending choice/effective date.

- [ ] Add authenticated route tests for all four products, unauthenticated access, changed email with stable user UUID, unknown tier/interval, price/product-ID injection, another user's portal/account, disabled Supporter checkout and change, duplicate tabs, provider timeout recovery, active subscriber sent to management, and checkout return without a paid event. Confirm Supporter URL never appears in public/Plus responses.

```ts
expect(disabledSupporterCheckout.statusCode).toBe(409);
expect(disabledSupporterPlanChange.statusCode).toBe(409);
expect(tamperedPriceRequest.statusCode).toBe(400);
expect(providerCreatedCheckouts).toHaveLength(1);
expect(accountBeforePayment.tier).toBe('free');
```

- [ ] Run `pnpm -C api test -- tests/billing.routes.test.ts`; verify expected failures.
- [ ] Implement strict request schemas and allowlisted product lookup. Set external customer ID from authenticated UUID and fixed trusted return URLs. Serialize checkout attempts by user: reuse a valid same-choice checkout, reject a conflicting pending choice, and reconcile ambiguous network outcomes via the stored attempt ID before retrying. Store provider operation IDs; never blindly repeat a create after timeout. Refresh provider state before creating a new subscription.
- [ ] Implement next-period tier/interval changes with the existing subscription and explicit `next_period` behavior. Expose feature availability for combinations validated in sandbox. If unsupported, return a typed conflict with `/contact` rather than creating a second subscription. Set the same default in the Polar portal so portal actions cannot silently change the policy. Grant no Supporter access before its paid effective period.
- [ ] Add billing route reservation to host SDK validation and both plugin-copy scripts. Rate-limit checkout/portal/refresh operations independently of chat quotas. Return billing-disabled availability without preventing Free use. Keep checkout-success refresh bounded; an outage must show pending confirmation rather than false success.
- [ ] Run focused tests plus `pnpm -C api test -- tests/extensions.test.ts tests/plugins-script.test.ts` and typecheck; expect PASS. Commit: `feat: expose subscription checkout and account APIs`.

## Task 4: Tier-aware session and text quotas

**Files:** Create `api/src/modules/quotas/window-quota.ts`, `api/tests/window-quota.redis.test.ts`; modify `api/src/plugins/rate-limit.ts`, `api/src/modules/sessions/sessions.route.ts`, `api/src/server.ts`, `api/src/index.ts`, `api/tests/rate-limit.test.ts`, test factory and CI Redis service setup.

**Interfaces:** `WindowQuota.consume({userId, bucket:'sessions'|'messages', count, max, windowMs}): Promise<QuotaDecision>` and `WindowQuota.read({userId,bucket,windowMs}): Promise<{used:number; resetsAt:Date|null}>`. `QuotaDecision` is `{allowed:true; used:number; remaining:number; resetsAt:Date}` or `{allowed:false; used:number; remaining:number; resetsAt:Date}`. `createWindowQuota({redis, now})` owns stable keys without tier in their names. A test/development in-memory implementation has the same atomic semantics. Host `checkTextMessageQuota` remains the hook used by plugins.

- [ ] Add tests with two independent clients against a disposable real Redis: concurrent consumes cannot exceed a ceiling, all-or-nothing batches, rejected batch leaves allowance unchanged, upgrade/downgrade changes ceiling on the same bucket, window TTL reset, user isolation, Redis outage returning 503, and legacy free usage retained during rollout. Integration-route tests cover batch/stream/playground sharing and voice-transcript exclusion. Pin approved values in catalog tests, use small injected ceilings for boundary tests.

```ts
expect(results.filter(r => r.allowed)).toHaveLength(3); // 10 simultaneous single consumes, cap 3
expect(afterRejectedBatch.used).toBe(beforeRejectedBatch.used);
expect(afterUpgrade.used).toBe(beforeUpgrade.used);
expect(redisOutageResponse.statusCode).toBe(503);
```

- [ ] Run `pnpm -C api test -- tests/rate-limit.test.ts tests/window-quota.redis.test.ts` with an isolated `QUOTA_TEST_REDIS_URL`; confirm new behavior fails. No tests may flush an arbitrary shared Redis database.
- [ ] Implement count/check/TTL atomically using one Redis Lua script; reject count above remaining without changing usage. Resolve entitlements after authentication and validation but before expensive work. Consume at acceptance, preserve the existing failed-provider-attempt policy, and remove the old two-session route limiter so it cannot keep blocking paid users. Preserve the separate per-minute abuse policies.
- [ ] Require Redis when billing is enabled in production and share keys across instances. Separate quota failure behavior from burst-limit `skipOnError`. Keep `RATE_LIMIT_ENABLED=false` as the explicit existing development/operator bypass, documented as disabling these text/session ceilings; billing-enabled production must reject that unsafe configuration. Read usage through the same store for the account endpoint. Keep the wire envelope compatible and add structured quota kind, current tier and contact/reset data.
- [ ] For migration, preserve existing bucket consumption if formats permit; otherwise document one explicit deployment-time reset of the short windows. Never reset buckets on ordinary subscription changes.
- [ ] Run focused tests and typecheck; expect PASS including actual Redis tests. Commit: `feat: apply paid session and message allowances`.

## Task 5: Creator plugin entitlement integration

**Files:** Modify host `api/src/extensions/sdk.ts`, `api/src/server.ts`, `api/tests/extensions.test.ts`, test plugin fixtures; modify `studio:plugins/creator/api/{index.ts,service.ts,personas.service.ts,playground.routes.ts}`, `studio:plugins/creator/shared/limits.ts`, `studio:plugins/creator/plugin.json`, `studio:plugins/creator/scripts/overlay-smoke.sh`, `studio:.github/workflows/plugin-overlay.yml`, creator tests and host/plugin API version constants in copy scripts if a version bump is used.

**Interfaces:** Add required `resolveEntitlements(userId: string): Promise<Entitlement>` to `ApiPluginContext` and re-export the type from host SDK. Pass the resolver into CreatorService and PersonaService constructors. Keep moderation settings separate from usage limits. Creator usage responses return resolved `used/max` for both inventories; playgrounds retain host `checkTextMessageQuota`.

- [ ] Add plugin integration cases: Free 3/10 versus paid 250/250, Plus/Supporter and month/year parity, create at boundary, two concurrent creates for last slot, saved drafts and published records counted together, soft-delete freeing a slot, restore/clone paths respecting caps, and downgrade retaining reads/edits/deletes while blocking additional creates. Test displayed max as well as enforcement.

```ts
expect(paidUsage.simulations.max).toBe(250);
expect(paidUsage.personas.max).toBe(250);
expect(concurrentLastSlotResults.filter(r => r.statusCode === 201)).toHaveLength(1);
expect(downgradedExistingRecord.statusCode).toBe(200);
```

- [ ] Run creator unit tests with `pnpm -C <studio-checkout> --filter @careersim-studio/creator test`. Integration tests are copied into the host by the overlay script and are not included in that unit command. In an explicit disposable host checkout with dependencies installed, run `CAREERSIM_HOST_DIR=<absolute-disposable-host> CAREERSIM_PLUGIN_DIR=<absolute-studio-checkout>/plugins sh <absolute-studio-checkout>/plugins/creator/scripts/overlay-smoke.sh`; confirm the new host integration cases fail. Never run this cleanup-capable overlay script against the user's primary checkout.
- [ ] Replace cached/global creator limits and the unused-user `limitsFor` implementation with the injected resolver. Lock the owner row in each count-and-create transaction; query and write through that same transaction. Include all record-creation paths and update usage responses. Remove stale limit APIs once callers are migrated.
- [ ] Version the extension contract coherently and fail startup for an incompatible enabled creator plugin. Update fixtures, SDK copy contracts and both host copy scripts together. The host must still build/run with no plugins. Record the plugin commit/revision required by the host; do not edit `extensions/installed` manually or publish either repo yet.
- [ ] Run creator unit tests/typecheck and the full overlay smoke script in the disposable host, then host extension tests and API typecheck with the plugin disabled; expect PASS. Confirm the output actually includes `api/tests/creator` integration cases and installed creator UI tests, rather than only shared utility tests. Commit separately in each repository: `feat: resolve creator limits from subscription entitlements`.

## Task 6: Voice limits and bounded call accounting

**Files:** Create `api/src/modules/voice/voice-usage.ts`, `api/tests/voice.usage.test.ts`; modify `api/src/modules/voice/{voice.service.ts,voice.route.ts,voice.schema.ts}`, `api/src/db/schema.ts`, generated migration metadata, `api/tests/voice.routes.test.ts`, `agent/src/careersim_agent/voice/{worker.py,state_bridge.py}`, `agent/tests/{test_voice_worker_session.py,test_state_bridge.py}`, `web/src/lib/{api.ts,types.ts}`, `web/src/components/voice/VoiceCallSurface.tsx`, `VOICE_MODE.md`.

**Interfaces:** Persist `voice_calls` with UUID `callId`, owner/session, started/ended times, last checkpoint, processed sequence, cumulative charged seconds and room. `checkpointCall({callId, sequence, cumulativeSeconds, ended}): Promise<{remainingSeconds:number; capSeconds:number; usageDate:string; resetAt:Date; continueCall:boolean}>`; internal authenticated route `POST /internal/voice/calls/:callId/checkpoint`. Resolve owner from the call record, not client input. Existing start response gains `call_id`; all end/budget callbacks carry it, so callbacks from a previous room cannot affect a new call. In `state_bridge.py`, add `APIClient.checkpoint_call(call_id: str, sequence: int, cumulative_seconds: int, ended: bool) -> dict[str, Any]`, validate its response at the boundary, and update `report_call_end` to carry call identity and final analysis without a second duration debit.

- [ ] Add API tests for the 720-minute paid cap, per-user Free override, concurrent starts across sessions, reconnect to the same active call, repeated/lower/out-of-order checkpoints, stale-call callback after replacement, UTC split, downgrade mid-call, revoked access, and server-rejected impossible duration. Worker tests cover refresh at midnight, cancellation final checkpoint, timeout cutoff and preservation of transcripts.

```ts
expect(paidBudget.capSeconds).toBe(43200);
expect(secondIdenticalCheckpoint.totalCharged).toBe(firstCheckpoint.totalCharged);
expect(previousDaySeconds + nextDaySeconds).toBe(120); // call 23:59 to 00:01 UTC
expect(concurrentStartSuccesses).toHaveLength(1);
```

- [ ] Run `pnpm -C api test -- tests/voice.usage.test.ts tests/voice.routes.test.ts` and, in `agent/`, `uv run pytest tests/test_voice_worker_session.py -q`; confirm new cases fail.
- [ ] Implement a per-user transactional active-call reservation and cumulative duration accounting. Checkpoint every 15 seconds, use server-time elapsed intervals to allocate deltas across UTC days, reject implausible increases, and make each sequence idempotent. Keep final checkpoints valid for a closed older call without letting them clear the new call. Checkpoint timestamps also provide liveness; reclaim abandoned slots after 60 seconds without a checkpoint, terminating their room before permitting continued old-worker activity.
- [ ] Refresh entitlements/budget on every checkpoint. A worker fails closed before starting expensive work if initial budget cannot be fetched. After repeated failure, end the room within 30 seconds of the last confirmed budget, flushing what is available for transcript/usage recovery. Stop a replaced/stale worker on its next checkpoint. Enforce runtime cutoff through worker/room control, not token expiry.
- [ ] Set join-token TTL independently to 10 minutes. LiveKit documents that expiry affects initial connection, not existing connections, and refreshes connected clients' tokens; use that behavior instead of building a renewal subsystem. Reauthorize fresh joins and validate actual self-hosted reconnect behavior in Task 9. Remove debit clamps derived from JWT TTL; clamp against server-observed call duration and remaining daily budget instead. Keep one active call per user.
- [ ] Run the focused API and worker tests plus related voice regression suites; expect PASS. Commit: `feat: enforce per-plan voice budgets across long calls`.

## Task 7: Pricing page with explicit allowances and annual billing

**Files:** Create `web/src/lib/billing.ts`, `web/src/app/(public)/pricing/page.tsx`, `web/src/components/billing/{PricingPage.tsx,PricingPage.test.tsx}`; modify `web/src/lib/api.ts`, `web/src/components/layout/{Navbar.tsx,Footer.tsx}`, `landing/src/pages/index.astro`; test `web/src/lib/landing-proxy.test.ts`.

**Interfaces:** `fetchPlanCatalog(): Promise<PlanCatalogResponse>` and authenticated `startCheckout(choice: BillingChoice): Promise<{url:string}>` in `web/src/lib/billing.ts`, using validated API wire schemas consistent with Task 1. `PricingPage({catalog: PlanCatalogResponse})` renders catalog data; no frontend-only cap constants. Derive wire types from API schemas/OpenAPI using existing project conventions rather than importing server runtime modules into the client.

- [ ] Write component tests for all three tiers, all five paid caps, Free overrides, monthly default, annual toggle, complete yearly charge, savings, auto-renewal copy, contact notice, the three exact Supporter benefit strings, disabled Supporter CTA, and custom 12-hour configuration windows. Test keyboard toggle and small-screen table/card visibility. Do not assert only a snapshot.

```tsx
expect(screen.getByText('Guidance and support from the development team')).toBeVisible();
expect(screen.getByText('Chat directly with the developers')).toBeVisible();
expect(screen.getByText("Help decide the project's future together")).toBeVisible();
expect(screen.getByText('Need higher limits? Contact us to discuss your needs.')).toBeVisible();
// After selecting Yearly, assert the full $90 and $1,000 totals and "billed yearly".
// With a 12-hour catalog window, assert "per 12 hours" and absence of "per 6 hours".
```

- [ ] Run `pnpm -C web test -- src/components/billing/PricingPage.test.tsx src/lib/landing-proxy.test.ts`; verify new tests fail.
- [ ] Implement the pricing page in the existing visual style, Plus primary, exact visible limits and benefits. Show 720 minutes as "720 voice minutes / day (12 hours)" and explain UTC reset. Label custom assets as saved totals. Annual mode shows $90/$1,000 upfront, secondary $7.50/about $83.33 monthly equivalents, and "2 months free". Do not headline unlimited use.
- [ ] Fetch a safe current catalog; do not render invented fallback prices on errors. Use a short-lived catalog cache and refresh before checkout. Keep `/pricing` served by Next.js, outside the marketing proxy allowlist. Link landing navigation to it instead of duplicating prices in Astro. Public visitors sign in with a validated internal return path preserving the selected tier/interval.
- [ ] Link contact notice to `/contact?reason=higher-limits`; authenticated paid cap errors use the same action, never an upsell to Supporter. Preserve the existing Free reset/upgrade path.
- [ ] Run focused tests and `pnpm -C web typecheck`; expect PASS. Commit: `feat: show subscription pricing and yearly savings`.

## Task 8: Account billing, Supporter access and personal contact

**Files:** Create `web/src/components/billing/{BillingPanel.tsx,BillingPanel.test.tsx}`, `web/src/app/(public)/contact/page.tsx`, `web/src/components/contact/{ContactForm.tsx,ContactForm.test.tsx}`; modify `web/src/components/auth/ProfilePage.tsx`, `web/src/lib/billing.ts`, `web/src/app/api/contact/{route.ts,route.test.ts}`, `web/src/lib/contact-client.ts`, chat quota error presentation and voice quota presentation where they currently render.

**Interfaces:** Add typed billing API wrappers for account/refresh/portal/change/supporter routes from Task 3. `BillingPanel()` fetches authenticated account state. `ContactForm({reason:'general'|'higher-limits'|'supporter'})` posts the existing multipart contact endpoint with `audience=personal`; missing audience remains legacy `business` behavior.

- [ ] Write tests for pending checkout without success, confirmed activation without re-login, annual paid-through and scheduled change dates, grace/canceled/revoked states, portal failure, lost auth, and Supporter CTA only with verified access. Assert all approved Supporter copy is visible. Contact tests verify personal requests accept no company, business requests still require one, reason validation, CAPTCHA, honeypot, length/rate limits and HTML escaping remain enforced.

```ts
expect(personalWithoutCompany.status).toBe(200);
expect(businessWithoutCompany.status).toBe(400);
expect(plusSupporterLinkResponse.statusCode).toBe(403);
// A pending checkout must display pending confirmation, never "Subscription active".
```

- [ ] Run `pnpm -C web test -- src/components/billing/BillingPanel.test.tsx src/components/contact/ContactForm.test.tsx src/app/api/contact/route.test.ts`; confirm new cases fail.
- [ ] Implement billing status, usage/reset details, cancellation/management links, scheduled choice display and bounded post-checkout refresh. Show current access date even if auto-renewal is canceled. After a verified tier change, refetch usage/entitlements; do not reload or mint a JWT to grant access.
- [ ] Show Supporter guidance, direct chat and shared roadmap benefits with the server-gated channel URL and joining instructions. The launch checklist requires working membership verification and removal. Use a private channel configured by the operator; no direct messaging integration, automatic invitation sending or voting application. Changing the launch flag must block new purchases without silently revoking existing paid users' access.
- [ ] Implement personal contact using existing mail delivery and abuse checks. Require name, valid email, and message; company is optional only for personal requests. Treat reason/context from URL or form as untrusted labels, never proof of Supporter status. Tests use intercepted mail; do not send real messages. Preserve `/business` behavior and its existing form payload.
- [ ] Run focused tests, web typecheck and related contact regressions; expect PASS. Commit: `feat: add billing management and supporter contact access`.

## Task 9: Integration evidence, deployment configuration and launch handoff

**Files:** Create `docs/BILLING.md`, `api/scripts/check-billing-catalog.ts`, `api/tests/billing.integration.test.ts`; update `README.md`, `VOICE_MODE.md`, `api/.env.example`, `web/.env.example` if present, active deployment env documentation, CI workflow and studio plugin revision references. Inspect the actual deployment path; old Kubernetes backend manifests are not the active Fastify configuration.

**Interfaces:** `check-billing-catalog.ts` is a read-only command that compares configured product IDs against Polar product amount/currency/interval/tax settings, prints a redacted mismatch report and exits nonzero on disagreement. Add `pnpm -C api billing:check` for it. It never creates or updates a product.

- [ ] Write an integration test spanning initial Free use → verified Plus payment → same counters with higher limits → scheduled yearly change → paid yearly renewal → cancellation at paid-through → Free with custom records preserved. Add Supporter parity and purchase-disable cases, missed-event reconciliation, provider-outage behavior, and account privacy isolation. Use real DB/Redis and the deterministic provider adapter.
- [ ] Run `pnpm -C api test -- tests/billing.integration.test.ts`; confirm failures expose missing integration, then wire the tasks until the test passes. Do not use actual live charges as test fixtures.
- [ ] Document four sandbox product mappings, exact cents/intervals and tax behavior, signed endpoint setup, events, reconciliation job, portal next-period settings, customer UUID mapping, refund/dispute operations, manual Supporter membership handling, and recovery from stale state. Record which observed SDK events establish payment and dispute state; if a required dispute signal is unavailable, document the provider dashboard-to-local suspension operation and test that path before launch.
- [ ] Document rollout order: migrations → compatible host/plugin artifacts → API/worker/web → sandbox evidence → enabled Plus checkout → separately cleared Supporter. Preserve webhook/reconciliation processing when disabling new purchases. The kill switch must not revoke existing paid users. Keep rollback schema additive and do not roll back to code that bills users but ignores entitlements.
- [ ] Run the read-only product check against sandbox when credentials are available. Exercise all four sandbox purchases, payment failure, grace, cancellation, annual interval changes, signed replay and refund; record exact observed outcomes. If credentials or provider acceptance are missing, mark the corresponding launch checks blocked, not passed. No need to ask the user for secrets in chat.
- [ ] Verify voice against the configured self-hosted LiveKit: active call survives initial token expiry; reconnect works; one-active-call guard holds; worker/API failure stops audio within the documented bounds; delayed checkpoints do not double-debit; UTC rollover works with injected clocks in tests.
- [ ] Run `pnpm -C api test`, `pnpm -C api typecheck`, `pnpm -C api lint`; run creator tests/typecheck in its checkout; run `pnpm -C web test`, `pnpm -C web typecheck`, `pnpm -C web lint`; in `agent/` run `uv run pytest tests/test_voice_worker_session.py tests/test_voice_worker.py tests/test_voice_integration.py -q`. Run production builds with plugins enabled and disabled using the supported plugin build scripts. Supply test-only services and credentials, never production accounts.
- [ ] Inspect pricing/account/contact in the browser at desktop and mobile widths, light/dark modes, keyboard-only navigation, both billing intervals and all three account tiers. Confirm every limit and Supporter benefit is visible, yearly totals are clear, contact submits to an intercepted destination, and disabled actions explain availability. Capture evidence without card/customer data.
- [ ] Commit task files: `docs: add subscription launch and recovery runbook`. Summarize test evidence, remaining external launch gates, both repo revisions, and migration order. Leave production product creation, deployment, real payment operations and external messages for their authorized release step.

## Planning self-review

- Spec coverage: catalog and lifecycle → Tasks 1–3; all five limits → Tasks 4–6; annual pricing and visibility → Task 7; guidance/direct chat/shared roadmap/contact → Task 8; provider eligibility and rollout → Task 9.
- Contracts flow from `billing.schema.ts` and the host plugin SDK. Provider DTOs do not escape the adapter; frontend wire schemas are validated and kept in sync with OpenAPI.
- Review Focus cases are assigned to concrete tests. Existing integration helpers/PGlite are reused; Redis concurrency uses a real isolated instance.
- The only new author implementation defaults are five-minute reconciliation, 15-second voice checkpoints, 30-second budget-failure cutoff, 60-second stale-call lease and 10-minute initial join tokens. These implement the approved bounded-failure behavior and are not new customer pricing promises.
- The exact Supporter channel and Polar acceptance remain release configuration/dependencies. No additional business decision blocks writing or reviewing this plan.

## Primary references checked on 2026-11-10

- https://polar.sh/docs/features/products
- https://polar.sh/docs/integrate/customer-state
- https://polar.sh/docs/integrate/webhooks/delivery
- https://polar.sh/docs/integrate/webhooks/events
- https://polar.sh/docs/api-reference/webhooks/order.paid
- https://polar.sh/docs/api-reference/subscriptions/update
- https://polar.sh/legal/acceptable-use-policy
- https://docs.livekit.io/frontends/reference/tokens-grants/
