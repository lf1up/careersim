# Subscription operations

The active billing implementation is in `api/`, with account and pricing UI in `web/`, voice accounting in `api/` and `agent/`, and creator inventory enforcement in the `careersim-studio` source plugin. Do not configure the deprecated Stripe integration in `backend/`.

This is a launch runbook, not evidence that sandbox or production billing has passed. No product creation, payment, invitation, provider contact or deployment is authorized by implementing this feature. Use synthetic accounts and sandbox payment methods for verification. Never include access tokens, webhook secrets, checkout URLs, customer data or card details in evidence.

All tiers include this shared benefit on pricing and account pages:

- Creator plugin access for custom personas and simulations

## Release status and gates

`BILLING_ENABLED` defaults to false and controls new purchases for both paid tiers. Creem starts enabled as the default provider; Polar starts disabled. Provider enablement does not open checkout by itself. Pro checkout also requires both Pro products for the selected provider and a configured private channel.

Keep the purchase gate closed until the release checks pass. The merchant reports completing Creem KYC; that does not establish complete store approval, live product configuration, or payment acceptance.

Pro provides its published usage limits, shared Creator plugin access, and these additional benefits:

- Guidance and support from the development team
- Chat directly with the developers
- Help decide the project's future together
- Early access to upcoming features, including MCP and API access

Configure and test the private channel and manual membership procedure. Do not silently change the published benefits.

| External launch check | Current evidence | Release consequence |
| --- | --- | --- |
| Four sandbox product IDs and read-only catalog audit | Not observed; sandbox credentials/mappings not supplied to this implementation | Block paid checkout until validated |
| Four sandbox purchases and paid lifecycle transitions | Not observed | Block each unverified product/flow |
| Signed public webhook delivery, replay and catch-up | Not observed against Creem or Polar | Block paid checkout |
| Portal next-period changes for every tier/interval pair | Not observed; self-service switching stays disabled | Keep contact fallback; do not enable switching |
| Provider dispute signal or tested dashboard-to-local suspension | Not observed against Creem or Polar | Block paid checkout until a working suspension path is tested |
| Pro private channel and membership controls | No channel/membership evidence recorded | Block Pro purchase |
| Configured self-hosted LiveKit end-to-end checks | Not observed in this task | Block paid voice claims until verified |
| Deployment destination, secret configuration, release artifacts | Not deployed by this task | Perform only in an authorized release |

Local tests demonstrate implementation behavior using deterministic provider fixtures. They cannot replace these provider and deployment checks. Record actual command outcomes in the release evidence described below, including failures and blocked checks.

## Catalog and tax contract

Configure four distinct server-only allowlisted products per enabled provider. Creem IDs start with `prod_`; Polar IDs are UUIDs. Arbitrary URLs are not product IDs. Free has no product. Keep sandbox and production IDs and credentials separate; a name or price never identifies a user's tier.

| Creem product setting | Retained Polar product setting | Tier | Price setting | Default USD cents | Interval | Count |
| --- | --- | --- | --- | ---: | --- | ---: |
| `CREEM_PLUS_MONTHLY_PRODUCT_ID` | `POLAR_PLUS_MONTHLY_PRODUCT_ID` | Plus | `PLUS_MONTHLY_PRICE_CENTS` | 900 | `month` | 1 |
| `CREEM_PLUS_YEARLY_PRODUCT_ID` | `POLAR_PLUS_YEARLY_PRODUCT_ID` | Plus | `PLUS_YEARLY_PRICE_CENTS` | 9000 | `year` | 1 |
| `CREEM_PRO_MONTHLY_PRODUCT_ID` | `POLAR_PRO_MONTHLY_PRODUCT_ID` | Pro | `PRO_MONTHLY_PRICE_CENTS` | 4900 | `month` | 1 |
| `CREEM_PRO_YEARLY_PRODUCT_ID` | `POLAR_PRO_YEARLY_PRODUCT_ID` | Pro | `PRO_YEARLY_PRICE_CENTS` | 49000 | `year` | 1 |

Price settings are positive integer USD cents, up to 2,147,483,647. Omitted settings use the defaults above. The API catalog and read-only catalog audit share these settings. Configure the same amounts on the corresponding products at every enabled provider before enabling purchases; changing an environment value does not change a provider product's charge. The `PLUS_*` price names map to the Plus tier, matching its existing paid-limit settings.

Configure active, unarchived products with a fixed USD amount, recurring billing at count 1, no trial, and explicit `exclusive` tax behavior. Creem uses `price`, `currency`, `billing_type`, `billing_period`, `recurring_interval`, `recurring_interval_count`, and `tax_mode`. Polar requires exactly one active fixed price; archived historical prices do not count. Listed prices are before applicable checkout taxes. `location` and `inclusive` do not satisfy that contract; the catalog check rejects both. See Creem's [product reference](https://docs.creem.io/api-reference/endpoint/get-product), Polar's [product configuration](https://polar.sh/docs/api-reference/products/create) and [checkout tax behavior](https://polar.sh/docs/api-reference/checkouts/get-session). Verify actual buyer-country checkout presentation before launch. Do not infer tax handling from a product display name or an organization default.

Yearly means a recurring full upfront yearly payment with yearly auto-renewal. Show the full annual total prominently. The "2 months free" badge appears only when the configured yearly price equals ten monthly payments, a 16.67% saving relative to twelve monthly payments. Other yearly prices omit that badge. There is no coupon, installment plan, lifetime product, usage charge or automatic overage. Both intervals grant identical caps. Annual purchase and interval changes never reset counters or grant a year of voice minutes upfront.

Run the read-only check in a shell with an injected sandbox-only secret environment:

```sh
pnpm -C api billing:check
```

The command audits every enabled provider independently using the shared four price settings. It defaults to `CREEM_ENABLED=true`, `POLAR_ENABLED=false`, and sandbox environments. Flags accept `true`, `false`, `1`, or `0`. Disabled providers need no credentials and make no requests, even if stale credentials or mappings remain configured.

For Creem, supply `CREEM_API_KEY`, `CREEM_ENVIRONMENT`, and four `CREEM_*_PRODUCT_ID` values. For enabled Polar, supply `POLAR_ACCESS_TOKEN`, `POLAR_ENVIRONMENT`, and four `POLAR_*_PRODUCT_ID` values. Environments accept only `sandbox` or `production`. Webhook secrets are not needed for this read-only audit.

The audit sends only product GET requests to fixed hosts: `test-api.creem.io` or `api.creem.io`, and `sandbox-api.polar.sh` or `api.polar.sh`. It refuses redirects, uses a 15-second request timeout, and exits nonzero for missing configuration, invalid prices, unreadable products, malformed responses, or catalog mismatches. The audit needs no database or unrelated application environment and does not load `.env` automatically. It never creates or updates products.

Load secrets through the release environment's secret manager. Do not put tokens in command arguments or chat. Reports contain provider and tier/interval labels and known mismatch fields, never product IDs, provider bodies, credentials, or raw exception messages.

A passing audit confirms product configuration only. Run it again against the explicitly selected production environment during the authorized release, with the production mappings, before purchases are enabled.

## Breaking configuration and API rename

The tiers are `free`, `plus`, and `pro`. Plus remains the middle tier. The former Supporter tier becomes Pro. This is a breaking configuration and API rename, with no compatibility aliases. An old `PRO_*` value means Plus in the previous release and Pro in this release.

| Previous name | Current name | Meaning |
| --- | --- | --- |
| `PRO_*` usage limits and prices | `PLUS_*` usage limits and prices | Preserve the existing Plus values |
| `SUPPORTER_*` usage limits and prices | `PRO_*` usage limits and prices | Preserve the former Supporter values for Pro |
| `POLAR_SUPPORTER_MONTHLY_PRODUCT_ID` | `POLAR_PRO_MONTHLY_PRODUCT_ID` | Keep the same monthly product UUID |
| `POLAR_SUPPORTER_YEARLY_PRODUCT_ID` | `POLAR_PRO_YEARLY_PRODUCT_ID` | Keep the same yearly product UUID |
| `SUPPORTER_CHANNEL_URL` | `PRO_CHANNEL_URL` | Keep the same private channel |
| Tier ID `supporter` | Tier ID `pro` | Rename stored and API tier values |
| API field `supporterAccess` | API field `proAccess` | Verified access to Pro benefits |
| `GET /billing/supporter` | `GET /billing/pro` | Authenticated private-channel instructions |
| Contact reason `supporter` | Contact reason `pro` | Personal Pro support requests |

The API and read-only catalog audit reject legacy `SUPPORTER_*` and `POLAR_SUPPORTER_*` settings, including blank entries, rather than silently applying old Plus settings to the new Pro tier. Remove those old keys after remapping their values.

The usage-limit suffixes are `SESSIONS_CREATE_MAX`, `CHAT_MESSAGES_MAX`, `CUSTOM_SIMULATIONS_MAX`, `CUSTOM_PERSONAS_MAX`, and `VOICE_DAILY_MINUTES_PER_USER`. The price suffixes are `MONTHLY_PRICE_CENTS` and `YEARLY_PRICE_CENTS`. `POLAR_PLUS_MONTHLY_PRODUCT_ID`, `POLAR_PLUS_YEARLY_PRODUCT_ID`, and the `plus` tier ID stay unchanged. API paths above use the deployment's configured version prefix.

1. Keep `BILLING_ENABLED=false` and `NEXT_PUBLIC_PRICING_ENABLED=false` during the transition. Back up the production database and deployed configuration.
2. Move every old `PRO_*` limit and price to its matching `PLUS_*` name first. Remove the old entries before assigning the new Pro values.
3. Move the former `SUPPORTER_*` limits, prices, and channel setting to `PRO_*`. Rename the two `POLAR_SUPPORTER_*_PRODUCT_ID` keys to `POLAR_PRO_*_PRODUCT_ID`, retaining their exact UUID values.
4. Save the remapped production environment as one atomic configuration update before deployment, preserving every configured value.
5. Stop old API writers before applying migration `0012`. The migration changes `supporter` to `pro` in `billing_customers.snapshot` at `choice.tier` and `pendingChange.choice.tier`, and in `checkout_attempts.tier`.
6. Deploy the compatible API, web, worker, and plugin release together. Update API consumers to `proAccess` and `/billing/pro` in the same release. Old clients and servers do not understand this contract. Do not restart old writers against migrated data.
7. Verify existing Plus and Pro accounts, pending checkouts, current subscriptions, and private-channel access before reopening purchases.

Keep existing Polar product UUIDs, customer mappings, and live subscriptions. Do not recreate products or subscriptions to rename tiers. Rename merchant product display names separately in Polar, preserving prices, intervals, and subscriptions. A display-name change alone does not change entitlement mapping. Rollback requires code, configuration, and stored tier values that agree on the same contract.

## Migrate provider ownership

Migration `0013` adds provider-scoped customer mappings, subscription and order keys, webhook identities, and checkout references. It labels all existing billing records `polar` and copies existing customer bindings and snapshots into `billing_provider_customers`. The account-wide verified snapshot remains the source of access. The new Creem default never relabels old subscriptions or moves them between providers.

1. Keep `BILLING_ENABLED=false`. Back up the database and deployed configuration.
2. Stop all old API writers before applying `0013`, after any required `0012` tier rename.
3. Apply the migration with the compatible API release. Verify populated records, foreign keys, existing paid deadlines, and pending checkouts before starting writers.
4. Keep historical Polar mappings. Enable and configure Polar explicitly if those records need remote management or fresh provider reads.
5. Verify rollback against the saved schema and compatible code. Never restart old writers against `0013` or relabel records to make rollback appear compatible.

Remote customer, subscription, order, checkout, and event identities are scoped by provider. The account lock still prevents simultaneous purchases across providers. Multiple renewable subscriptions or conflicting paid grants require reconciliation and block new purchases. Do not sum paid allowances. Preserve the last unambiguous verified access only through its existing deadline.

## Configuration and active deployment path

`docker-compose.local.yml` is the current local Fastify deployment path. Its `api` service loads `api/.env` and overrides database/Redis/agent hostnames and `API_VERSION_PREFIX=v1`. The current bare-container API default has no version prefix. Register the webhook with the actual externally routed prefix, rather than assuming `/v1` everywhere. The web API base URL and voice worker prefix must match.

The old `infrastructure/k8s/base/backend-deployment.yaml` and legacy AWS infrastructure target the deprecated stack. They are not a source of Fastify billing configuration. Before an authorized cloud release, inspect the actual target's service settings, image revision, API prefix, ingress body handling, secret store and job scheduling. This task does not establish a production destination by editing an old manifest.

| Setting | Operator use |
| --- | --- |
| `BILLING_ENABLED` | Opens new paid purchases. Start false; disabling does not revoke paid access or stop enabled-provider webhooks and reconciliation. |
| `BILLING_DEFAULT_PROVIDER` | `creem` initially. Must name an enabled provider. |
| `BILLING_COUNTRY_PROVIDERS` | Empty initially. Optional comma-separated ISO 3166-1 alpha-2 routes, such as `GE=creem,US=polar`. Every referenced provider must be enabled. Unknown providers, invalid or duplicate countries, and routes to disabled providers fail startup. |
| `CREEM_ENABLED`, `POLAR_ENABLED` | Independent provider availability, initially `true` and `false`. Disabled providers make no remote reads, accept no new purchases, and perform no remote management. |
| `CREEM_ENVIRONMENT`, `POLAR_ENVIRONMENT` | `sandbox` initially; `production` only for an authorized release. Keep each provider's environments separate. |
| `CREEM_API_KEY` | Server-only Creem API key for the selected environment. Never expose through `NEXT_PUBLIC_*`. |
| `CREEM_WEBHOOK_SECRET` | Signing secret for that environment's `/billing/webhook/creem` registration. |
| Four `CREEM_*_PRODUCT_ID` values | Exact server-selected mappings above. |
| `POLAR_ACCESS_TOKEN` | Server-only token for enabled Polar's checkout, customer, subscription, order, and dispute operations. Use least privilege supported by Polar. |
| `POLAR_WEBHOOK_SECRET` | Signing secret for that environment's retained `/billing/webhook` registration. |
| Four `POLAR_*_PRODUCT_ID` values | Retained exact Polar mappings. Disabled Polar needs no credentials or products. |
| `PRO_CHANNEL_URL` | Private channel URL, exposed only to verified Pro subscribers. A hidden URL alone does not enforce membership. |
| `BILLING_CONTACT_URL` | Higher-limit and unavailable-plan contact destination, normally `/contact`. |
| `REDIS_URL` | Shared quota counters required for multiple API instances. Use persistent Redis and retain keys through their quota window. |
| Free limit and window settings | Preserve deployed unprefixed overrides. Default session/message windows are six hours. |
| Five `PLUS_*` limit settings | Plus usage caps, shown below. |
| Five `PRO_*` limit settings | Independent Pro usage caps, shown below. |

With the initial Creem default and no country overrides, all new purchases use Creem and pricing shows no country selector. When overrides exist, checkout requires an explicit billing country and the UI submits its uppercase ISO code. Country means the customer's billing address, not merchant residency or an inferred IP, language, or timezone. Selection uses the exact country override or the default provider and never falls back after a timeout or rejected payment. Existing subscriptions and pending checkouts keep their stored provider regardless of routing changes.

Disabling a provider is different from closing purchases with `BILLING_ENABLED=false`. Its webhook returns a retryable 503 without acknowledgement, its jobs make no calls, and its customers use the contact path for unavailable management. Stored paid access expires at its verified deadline. To keep existing Polar subscriptions synchronized while Creem handles new purchases, enable Polar with its own credentials and mappings while leaving Creem as the default.

Defaults for each tier are:

| Limit | Plus (`PLUS_`) | Pro (`PRO_`) |
| --- | ---: | ---: |
| `SESSIONS_CREATE_MAX` | 100 | 200 |
| `CHAT_MESSAGES_MAX` | 3000 | 6000 |
| `CUSTOM_SIMULATIONS_MAX` | 250 | 500 |
| `CUSTOM_PERSONAS_MAX` | 250 | 500 |
| `VOICE_DAILY_MINUTES_PER_USER` | 360 | 720 |

Each setting combines its tier prefix with the limit name, for example `PRO_CHAT_MESSAGES_MAX=6000`. Values must be positive safe integers within storage bounds and at least the effective Free caps. Tier overrides are independent. Monthly and yearly billing use the same limits within each tier. A zero unlimited Free voice cap is incompatible with finite paid quotas. Voice resets at midnight UTC. Custom simulation/persona caps count owned, non-deleted inventory including drafts, rather than monthly creation credits.

Quota-storage failures must block new expensive work with a retryable error. Burst limiter fallback is not permission to bypass subscription quotas. Catastrophic Redis data loss can reset a window; these counters are application limits, not a financial ledger. Retain saved records through downgrade, and block only new inventory until the owner is below the effective cap.

## Provider identity and signed events

Bind each provider customer to the immutable CareerSIM user UUID through the persisted checkout attempt and verified provider evidence. Polar uses that UUID as its external customer ID. Creem checkout metadata contains the server-written user and attempt UUIDs; `request_id` correlates the attempt. Email changes do not change ownership. Never attach a customer by email alone or grant access from product names, return URLs, amounts alone, or browser-written metadata. Account, refresh, and portal requests use the authenticated user. Do not log hosted checkout or portal URLs.

Register Creem at `{API_VERSION_PREFIX}/billing/webhook/creem`. Preserve the raw request bytes and validate the `creem-signature` HMAC before processing. The retained Polar endpoint is `{API_VERSION_PREFIX}/billing/webhook`; it validates Standard Webhooks headers with `POLAR_WEBHOOK_SECRET`. Use the actual deployed prefix. A disabled provider returns 503 without acknowledging or processing its events.

Persist normalized events with provider-scoped identity and synchronize under the account lock. Events trigger authoritative provider reads; reordered payloads cannot overwrite newer facts. A signed event, `subscription.active`, `subscription.created`, or checkout return alone does not prove a paid period. Creem requires verified paid transactions with recognized product, ownership, amount, USD currency, and real period boundaries. Polar requires the corresponding successful paid order. Refund evidence stays attached to its transaction and period, so historical refunds cannot erase newer access.

The Polar adapter retains `@polar-sh/sdk` 1.0.2 and API version 2026-10, including order period timestamps and dispute reads. Verify configured event names, signature replay, payment evidence, and dispute-read permissions for each enabled provider before launch. No real provider event has been observed in this implementation task.

Creem manual resends may carry new event IDs. Deduplicate payment, refund, and dispute effects by their provider transaction as well as event identity. An open or lost current-period dispute removes access. Missing dispute evidence never establishes a merchant win. Creem's documented reads do not establish a complete dispute-resolution feed, so restoration needs provider-confirmed evidence and an operator recovery procedure tested before launch. Do not automate restoration from an absent event or build an unaudited override endpoint. Cancellation alone does not suspend an already paid disputed period.

## Lifecycle and recovery

Persist the chosen provider, plan, interval, selected country, and attempt before creating a hosted checkout. Reuse a known open checkout for the same choice. One account-wide lock prevents competing tabs from creating subscriptions at different providers. A checkout return remains pending until authoritative reads verify payment.

Polar checkouts include the available paid products and retain the tested same-session product-update path. Polar can select only products included when the checkout was created. Older single-product sessions must expire before another plan can be chosen. An update failure never permits a replacement while the original remains payable.

Creem has no supported checkout replacement capability in this adapter. Open Creem checkouts can have unknown expiry. A different choice stays blocked while the old checkout could still be paid. A local timeout is not remote closure.

Treat an ambiguous create response as unresolved. Creem `request_id` is correlation, not assumed idempotency or a documented lookup by attempt. Do not issue a fresh create merely because a response was lost. Keep replacement blocked until a verified signed event binds the attempt to its remote checkout, an authoritative read confirms closure, or an operator establishes closure with provider evidence. A signed reference still needs a fresh read to establish payment. Document the evidence and recovery procedure before opening purchases; this release adds no automatic operator override.

| Situation | Required access behavior | Operator check |
| --- | --- | --- |
| New account / unpaid initial checkout | Free, no grace | Checkout return remains pending until verified payment |
| Verified paid order | Paid through its actual period end | All five paid caps; same existing counters |
| Failed renewal after a paid period | 72-hour grace after paid-through, then Free | No indefinite extension during provider outage |
| Voluntary cancellation | Retain paid access through paid-through, then Free | No failed-payment grace for cancellation |
| Explicit immediate revocation | Remove paid access immediately | Synchronize authoritative state |
| Full refund of current period | End corresponding access immediately | Ensure subscription is ended using authorized provider operations |
| Partial or historical refund | No revocation of newer paid access by refund alone | Replay both event orders |
| Open current-period dispute | Suspend paid access | Restore only after confirmed merchant win while period remains valid |
| Lost dispute | Revoke disputed access | Keep unrelated newer-period facts intact |
| Provider outage | Use stored verified access only until paid-through/grace deadline | Keep retrying synchronization; no new fabricated grant |
| Database outage | Service error | Never silently downgrade or grant access |

Periodically reconcile each enabled provider independently even when no webhook arrives, and offer authenticated refresh after checkout. The runtime reconciliation job and cadence must be enabled on every released API deployment according to its configuration; use the per-account lock to serialize updates. Monitor reconciliation errors, last successful sync time, queued webhook failures and duplicate subscriptions. A stale webhook payload must trigger a fresh provider read rather than overwrite newer state.

For stale state, first verify the configured environment and the user's immutable UUID. Inspect the private provider dashboard for the current subscription and paid orders, then run the authenticated refresh or the reconciliation job. Compare paid period, recognized product, cancellation, refund and pending-change facts. Retry failed event processing only after fixing the cause. Do not edit paid-through timestamps to manufacture access, clear counters, or attach another customer's subscription. Unexpected multiple active subscriptions across providers require operator review and block new checkout; never sum their caps.

Refunds, cancellations, revocations and dispute handling are payment operations requiring the corresponding release/operator authorization. After an authorized provider action, refresh authoritative local state, verify the affected order/period and confirm quota access. Preserve an audit record without payment credentials. Cancellation is not a substitute for an immediate dispute suspension.

A fully refunded paid period stops granting access. Once the provider confirms that its subscription cannot renew, the account can start a new purchase. A pending cancellation still blocks a second payable subscription.

Self-service tier and interval changes stay unavailable until sandbox proves each applicable adapter can schedule one combined replacement with `next_period` and no proration or overlapping subscription. Test monthly-to-yearly, yearly-to-monthly and every tier transition. Confirm the next full charge and effective date before confirmation, preserve current benefits through the paid period, and retain the contact fallback for unsupported combinations. Configure the Polar organization portal policy for `next_period`; customer session creation cannot force that policy. Disable portal product switching while sandbox validation is missing or Pro products and channel are not configured. For enabled providers, portal access for invoices, payment methods and cancellation remains available when `BILLING_ENABLED=false`. A disabled provider instead shows the contact path. Verify that Creem cancellation stops renewal while preserving the actual paid period; a generic `canceled` status alone is not immediate revocation.

## Manual Pro membership

Do not send invitations during implementation. Before enabling Pro, choose a private channel with actual membership controls and an operator responsible for the initial cohort.

1. Check the authenticated user's verified Pro entitlement and current paid/grace deadline in CareerSIM. A forwarded link, checkout screenshot or email address is insufficient.
2. Match the channel identity to the immutable user UUID using an authenticated support exchange. Record only the minimum identity mapping in the operator's restricted log.
3. Grant membership manually, record the verified period and provide the configured channel instructions. Honor the four benefit lines above without promising equity, a veto, guaranteed delivery or a fixed response-time SLA.
4. Review membership on entitlement changes and on a regular operator schedule. Remove access promptly after expiry, revocation, full current-period refund or open/lost dispute. Cancellation alone retains membership through paid-through.
5. Recheck current entitlement before restoring membership after a dispute or renewal. Confirm that a removed account cannot rejoin using an old URL. Keep support guidance available through the standard contact route while billing is resolved.

## Rollout and rollback

1. Back up Postgres and the deployed configuration. Stop old API writers before migration `0013`. Keep `BILLING_ENABLED=false`.
2. Apply billing/voice schema migrations, including the tier-data rename and provider-ownership migration `0013`, with the compatible release. Follow the [breaking rename procedure](#breaking-configuration-and-api-rename) when upgrading existing configuration. Do not remove existing tables or saved records.
3. Build the compatible host extension contract and creator source revision together. Record both repository SHAs. Never patch `extensions/installed` generated copies as the source change. Test production builds with plugins enabled and disabled.
4. Release the compatible API, agent voice worker and web artifacts. Verify shared Redis and runtime reconciliation, signed raw-body webhooks and immutable UUID mapping. Keep checkout disabled while existing paid-state processing operates.
5. Complete the sandbox matrix, local verification and privacy-safe browser evidence below. Verify LiveKit against its configured self-hosted endpoint, not only a mocked client.
6. During the authorized release, audit the separate production product mappings and enable purchases with `BILLING_ENABLED=true` after verifying the configured paid tiers.
7. Verify Pro private membership controls and checkout for both intervals. No separate Pro launch flag is required.

During an incident, disable new purchases with `BILLING_ENABLED=false`. Keep entitlement resolution, signed event processing, reconciliation and existing-customer portal access running. This kill switch must not downgrade existing subscribers. Roll back only to a build that understands stored billing entitlements and the compatible plugin contract. Preserve billing and voice history. Migration `0013` changes keys and removes the old customer-ID column, so a pre-migration API needs a compatible schema rollback as well as compatible configuration. Do not restore code that collects payments but ignores access. If compatible rollback is unavailable, hold checkout closed and forward-fix.

## Evidence to collect before launch

For each row, record date, sandbox environment, host/plugin revisions, command or precise action, expected outcome, actual outcome, and a redacted artifact reference. Use `blocked` when credentials or a required provider signal are missing. Never turn an unperformed step into `passed`.

| Sandbox exercise | Expected observation | Observed outcome |
| --- | --- | --- |
| Read-only four-product audit per enabled provider | All configured prices, cadences, and tax settings match | Blocked; no supplied sandbox credentials/mappings |
| Initial purchase for all four mappings | Only verified payment activates the correct tier and its configured limits; both intervals share that tier's caps | Not run |
| Unpaid initial checkout | Free, no grace | Not run against Creem or Polar |
| Failed paid renewal | Three-day grace then Free using injected clocks where needed | Not run against Creem or Polar |
| Monthly and yearly cancellation | Access ends at real paid-through; no grace | Not run against Creem or Polar |
| Every tier/interval scheduled replacement | One `next_period` change, no immediate charge or overlap | Not run; self-service switching disabled |
| Paid yearly renewal | Actual provider boundaries extend access; counters unchanged | Not run against Creem or Polar |
| Valid signed event, duplicate and reversed replay | Idempotent fresh synchronization; forged signature rejected | Not run against Creem or Polar |
| Missing event and provider outage | Reconciliation catches up; stored access expires within bounds | Not run against Creem or Polar |
| Full current-period, partial and historical refunds | Only current fully refunded access revoked | Not run against Creem or Polar |
| Open, won and lost dispute | Suspend or revoke the correct period; restore only from provider-confirmed resolution | Blocked until real signal or local suspension path tested |
| Two tabs across providers and duplicate subscriptions | Pending checkout reused or blocked; conflict blocks another purchase; no summed entitlement | Not run against Creem or Polar |
| Lost Creem create response and unknown expiry | No second payable checkout; signed-event recovery or verified operator evidence | Not run |
| Country override and default selection | Explicit ISO selection only when required; correct enabled provider, no silent fallback | Not run |
| Disabled provider | No credentials or remote calls required; webhook returns retryable 503 | Local fixture tests only |
| Portal after purchase kill switch | Existing invoices/payment/cancellation work; gated Pro unreachable | Not run against Creem or Polar |

Run the full API suite, typecheck and lint; web suite, typecheck and lint; creator source suite/typecheck; the planned Python voice suites; and enabled/disabled plugin production builds. The task coordinator records exact local outputs and limitations. Deterministic integration tests should use a real isolated DB/Redis and test-only credentials, not a live charge.

Inspect pricing/account/contact at desktop/mobile widths in light/dark mode, keyboard navigation, both intervals and all three tiers, explicit country selection when required, and conflict/unavailable-provider messages. Capture all five visible limits, four Pro benefit lines, clear annual total and renewal terms, unavailable-action explanation and personal contact without company. Intercept the contact destination rather than emailing a real recipient. Never include card/customer data in screenshots.

The configured LiveKit check must cover a call surviving initial token expiry, reconnect, one-active-call enforcement, worker/API failure cutoff within documented bounds, delayed deduplicated checkpoints and injected UTC rollover. See [VOICE_MODE.md](../VOICE_MODE.md) for token, checkpoint and cutoff settings. A Python unit test alone does not establish the deployed reconnect path.

Monitor active users by tier, usage cap encounters, provider costs, voice minutes, webhook verification/processing failures, billing staleness and reconciliation errors. High allowances do not guarantee that subscription revenue covers every user's model costs. Investigate cost drift without silently reducing the approved caps.
