# Unified billing with Creem as the initial provider

Status: proposed for approval. This document describes intended changes, not completed implementation or live-payment verification.

## Intent and confirmed requirements

CareerSIM needs one subscription system that can use several payment providers concurrently, with new purchases routed by customer country. Keep the Polar integration for future use.

Initially, Creem handles every new purchase. Polar is disabled. The merchant operates from Georgia and reports completing Creem KYC. A future US or UK company is outside this change.

Keep Free, Plus, and Pro, their current limits, the four monthly and yearly prices, and the existing access policies. Provider selection must not change usage counters.

## Approaches

A single global provider switch is smaller initially, but cannot support simultaneous country-based providers. Separate billing systems for each provider would duplicate entitlement, quota, and subscription rules.

Use shared subscription orchestration with provider adapters and an explicit country-routing policy. The user selected concurrent providers, future country-specific routing, and retained Polar support. The specific interfaces and migration below are implementation recommendations.

## Scope and exclusions

Implement the shared provider contract, Creem adapter, preserved Polar adapter, country routing, provider-scoped storage, webhook processing, reconciliation, catalog checks, configuration, account UI integration, and regression tests.

Do not add an India or Korea provider yet. Do not move subscriptions between providers, create parallel subscriptions, add metered charges, introduce credits, or enable self-service plan switching. Company formation and future merchant-account migration are separate work.

Implementation does not enable live checkout by itself. Keep the existing purchase gate. Creating live products, charging cards, deploying, and setting production secrets require an actual release task.

## Current behavior and affected boundaries

- `api/src/server.ts` constructs one Polar provider and enables reconciliation based on Polar credentials.
- `api/src/modules/billing/polar.ts` owns both the provider interface and the Polar SDK adapter.
- `catalog.ts` resolves every product through Polar environment variables.
- `billing.service.ts` assumes every checkout has an expiry and can change products in place.
- `webhook.route.ts` validates Polar signatures and triggers a fresh provider read.
- `billing_customers` stores one customer ID and one entitlement snapshot per CareerSIM user.
- `billing_subscriptions`, `billing_orders`, checkout attempts, and webhook inbox entries lack a provider discriminator.
- `entitlements.ts` computes time-bounded access from a verified snapshot. Quota consumers already use that shared entitlement service.

Retain the shared entitlement service. Change the provider boundaries rather than duplicate quota logic or introduce a separate Creem user tier.

## Provider selection and configuration

Use a closed provider identifier, initially `creem | polar`. Each provider has independent credentials, environment, product mappings, and an enabled flag.

The initial configuration has Creem enabled, Polar disabled, Creem as the default provider, and no country overrides. `BILLING_ENABLED` continues to control new purchases independently of provider availability.

Country overrides map validated ISO 3166-1 alpha-2 country codes to enabled providers. Validate duplicates, unknown provider identifiers, and references to disabled providers at startup. Provider credentials and product completeness are required only for enabled providers and supported paid choices. Disabled Polar needs no credentials and makes no network calls.

For a new purchase, select an exact country override or the default provider. Reject an unavailable choice. Do not silently fall back to another provider after a timeout or rejected payment.

With no overrides, the current checkout request can remain `{ tier, interval }` and all purchases use Creem. Add an optional `billingCountry` field for explicit country selection. Once overrides are configured, require a selected country before creating checkout and show the selector in pricing. Country codes describe customer billing country, not the merchant's Georgia residency. IP, language, and timezone do not establish billing country.

The provider still enforces its own purchase restrictions. Routing eligibility does not promise payment acceptance. Compare the provider-confirmed billing country with the selected country when available, record discrepancies for support, and use confirmed data for subsequent purchase eligibility. A discrepancy alone must not discard a verified payment or manufacture a second charge.

Existing subscriptions and open checkout attempts always use their stored provider, even when the routing policy changes. A disabled provider cannot accept new purchases or perform remote management. Surface that state with the existing contact path. Do not redirect those customers into a second subscription.

## Domain ownership and persistence

Keep `billing_customers` as the account-wide lock and source of the aggregate access snapshot. Move provider customer IDs and provider-specific snapshots into a `billing_provider_customers` table keyed by user and provider. Give remote customer IDs a uniqueness constraint within their provider.

Add the provider identifier to subscriptions, orders, webhook inbox records, and checkout attempts. Scope remote IDs and foreign keys by provider. Local checkout attempt UUIDs remain globally unique and store the chosen provider, product choice, and selected country.

Use one account-wide lock for checkout admission, provider-state merges, aggregate snapshot selection, and duplicate-subscription detection. Do not serialize independent users through a global lock.

The account may retain historical subscriptions and customer mappings with several providers. It may have only one intended billable subscription or unresolved checkout at a time. Do not sum paid tiers or allowances. If more than one subscription still grants access or can renew, flag a billing conflict, block additional purchases, and require reconciliation. Preserve the last unambiguous verified snapshot through its existing deadline while the conflict is unresolved.

A migration marks all existing billing records as `polar`, creates matching provider customer rows, and preserves the current aggregate snapshots and history. Migrate referencing keys together. Never infer that an old record belongs to Creem from the new default.

Use a coordinated API upgrade for this schema change. Old API writers must stop before migration. Test populated migrations and duplicate remote IDs across providers. Rollback must restore compatible code and schema without relabeling provider ownership.

## Shared interfaces and module boundaries

Move `BillingProvider` and normalized provider types into `provider.ts`. Keep SDK and wire representations inside `polar.ts` and `creem.ts`.

The service selects an adapter using the stored provider for an existing billing operation or the routing policy for a new intent. Adapter calls receive persisted customer, subscription, and attempt references instead of expecting a global lookup by email.

Model checkout inspection as explicit states: open with known or unknown expiry, completed, closed, or unknown. Recovery distinguishes a confirmed missing checkout from an unknown result. Make product replacement and recovery explicit adapter capabilities. Do not require an unsupported operation from every provider or invent an expiry.

Keep normalized paid transactions, payment periods, cancellation, failed renewal, refunds, and dispute evidence in the shared snapshot model. The shared service owns access rules and duplicate prevention. Adapters own signature verification, external requests, pagination, remote identity checks, and normalized payment facts.

`routing.ts` owns pure provider selection. `catalog.ts` owns internal choices, prices, limits, and provider-specific product maps. `sync.ts` owns verified persistence and aggregate snapshot updates. `reconcile.ts` processes due provider records and webhook work. Framework routes validate requests and invoke those owners.

Use the official core `creem` TypeScript SDK in the Fastify API if its pinned contract supports the required operations. Use validated REST calls for documented gaps. Do not install a Next.js billing integration or move payment secrets into `web/`.

## Checkout and identity flow

1. Authenticate the CareerSIM user and validate the internal plan choice and optional billing country.
2. Refresh relevant known provider state before admitting a new subscription. Skip disabled providers' network calls, but inspect their stored billing obligations.
3. Under the account lock, block an existing billable subscription, unexpired paid access, or unresolved checkout across all providers.
4. Persist the checkout intent with provider, immutable CareerSIM user UUID, server-selected product, and attempt UUID before the external call.
5. Create hosted checkout using server-written identity and attempt metadata. Use Creem `request_id` for attempt correlation. Verify retry behavior before relying on it for duplicate prevention.
6. Persist the returned remote checkout reference and redirect the customer.
7. Verify the payment through signed events and authoritative provider reads. The browser return URL never grants access.

Bind the remote customer to the initiating CareerSIM UUID through verified checkout intent and provider evidence. Never attach a customer by email alone. Reject mismatched customer or subscription ownership. Persist remote references as soon as verified so later reconciliation can use direct reads.

Reuse a known open checkout for the same choice. Polar can retain its tested product-update path. For Creem, block a different choice while the old checkout remains payable unless the provider proves safe replacement or closure. Show the reason and support path. Do not treat local timeout or an absent expiry as remote cancellation.

An ambiguous create outcome stays unresolved and blocks a replacement. Recover with documented lookup or verified idempotent replay using the same attempt. If unavailable, use a verified later webhook or an operator-confirmed closure. Document that recovery limitation before enabling purchases. Never unlock an ambiguous attempt solely because time elapsed.

## Webhooks and reconciliation

Use separate provider webhook routes and secrets. Preserve the existing Polar route for configured future Polar deployments and existing external registrations. Verify Creem's `creem-signature` HMAC over the original request bytes before processing.

Persist minimal normalized evidence with provider-scoped event identity. Creem manual resends can have new event IDs, so merging payment, refund, and dispute facts must also be idempotent by remote transaction and effect.

Persist webhook work before acknowledgement and process it through the shared account lock. Fetch current authoritative state rather than overwrite the account with stale event snapshots. Missing customer bindings remain pending for retry. Keep the existing bounded retry and backoff behavior.

Reconcile enabled providers' known customer and subscription records independently. Do not scan Creem's entire store for every account. At startup, ignore disabled Polar credentials and jobs. Disabled-provider webhook requests return a retryable error without acknowledgement or processing. Preserve stored paid access only through its verified deadline.

## Access behavior and lifecycle

Keep the current rules: confirmed payment grants access through the actual paid period, failed renewal permits the existing 72-hour grace, voluntary cancellation preserves the paid period, and provider failures cannot extend access.

Creem `subscription.paid` and authoritative paid transactions establish payment proof. `subscription.active` alone does not. Verify transaction status, ownership, USD currency, allowlisted product, amount and refund fields, and real payment-period boundaries.

Cancellation state must distinguish stopped renewal from explicit immediate revocation. Do not map every Creem `canceled` status to immediate loss of the paid period. Confirm portal cancellation behavior in test mode.

Preserve the existing current-period full-refund policy and historical or partial refund behavior. Immediate provider cancellation used for a fully refunded current period must be scoped to that provider and subscription.

An open or lost current-period dispute removes paid access. Absence of dispute evidence does not restore it. Creem's public reference does not establish a complete dispute-resolution API. Keep unresolved suspensions until provider-confirmed evidence supports restoration. Document and verify an operator recovery procedure before live launch. Do not build an unaudited override endpoint.

Self-service tier and interval changes remain disabled. Retain the contact path until each provider proves next-period changes without proration or overlapping subscriptions.

## User experience and operations

Keep existing pricing, account status, limits, and Pro membership behavior. Add country selection only when country overrides require it. Existing account management targets the subscription's provider.

Expose actionable checkout conflict and provider-unavailable messages through the current API error pattern. Do not show API keys, provider customer IDs, or internal routing configuration in product screens.

Extend `billing:check` to audit enabled providers' selected products using read-only operations. Verify price, currency, recurrence, tax-exclusive behavior, and absence of a trial. Retain the existing Polar audit behavior for future enabled Polar setups.

Update environment examples, relevant deployment configuration, the runbook, and test fixtures together. Keep production secrets out of Git and chat. KYC completion is recorded as user-reported; it is not evidence of complete store approval, live product configuration, or payment acceptance.

## Verification and release evidence

Local tests must cover routing, disabled-provider isolation, provider-scoped identities, populated migration, cross-provider checkout races, ambiguous results, webhook replay and reordering, authoritative refresh, cancellation, paid renewals, full and partial refunds, disputes, outages, and unchanged quota counters.

Run API typecheck, lint, and the affected tests. Run web checks and billing component tests for changed API or UI contracts. Use the repository's real database test harness for migration and concurrency behavior.

Before live purchases, verify four Creem products, tax presentation, signed public webhook delivery, initial and renewal payments, cancellation, recovery after a missed event, and refund and dispute handling. No sandbox or live verification has been performed by writing this design.

## Source references

- [Existing billing runbook](../../BILLING.md)
- [Existing subscription design](2026-11-10-subscription-tiers-design.md)
- [Creem core SDK](https://docs.creem.io/code/sdks/typescript)
- [Creem checkout creation](https://docs.creem.io/api-reference/endpoint/create-checkout)
- [Creem checkout retrieval](https://docs.creem.io/api-reference/endpoint/get-checkout)
- [Creem transactions](https://docs.creem.io/api-reference/endpoint/get-transactions)
- [Creem webhooks](https://docs.creem.io/code/webhooks)
- [Creem cancellation](https://docs.creem.io/api-reference/endpoint/cancel-subscription)
- [Creem test mode](https://docs.creem.io/getting-started/test-mode)

Checked against public documentation on 2026-11-17. Documented behavior still requires integration verification.
