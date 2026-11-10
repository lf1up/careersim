# Subscription operations

The active billing implementation is in `api/`, with account and pricing UI in `web/`, voice accounting in `api/` and `agent/`, and creator inventory enforcement in the `careersim-studio` source plugin. Do not configure the deprecated Stripe integration in `backend/`.

This is a launch runbook, not evidence that sandbox or production billing has passed. No product creation, payment, invitation, provider contact or deployment is authorized by implementing this feature. Use synthetic accounts and sandbox payment methods for verification. Never include access tokens, webhook secrets, checkout URLs, customer data or card details in evidence.

## Release status and gates

Both purchase flags default to false. Plus may launch after its technical and operational checks pass. Supporter has a separate provider eligibility gate for both intervals and all plan-change entry points.

Polar's [acceptable use policy](https://polar.sh/legal/acceptable-use-policy) lists donations, community access and sponsorship among prohibited categories. Obtain written acceptance of the actual offer before enabling Supporter, including $100/month and $1,000/year, the same SaaS caps as Plus, and these exact benefits:

- Guidance and support from the development team
- Chat directly with the developers
- Help decide the project's future together

A SaaS label, a successful catalog check, or a working checkout does not establish eligibility. Configure and test the private channel and manual membership procedure too. Keep `SUPPORTER_CHECKOUT_ENABLED=false` until the owner records acceptance and the channel is ready. A rejection requires an owner decision about the offer or provider. Do not silently change benefits.

| External launch check | Current evidence | Release consequence |
| --- | --- | --- |
| Four sandbox product IDs and read-only catalog audit | Not observed; sandbox credentials/mappings not supplied to this implementation | Block paid checkout until validated |
| Four sandbox purchases and paid lifecycle transitions | Not observed | Block each unverified product/flow |
| Signed public webhook delivery, replay and catch-up | Not observed against Polar | Block paid checkout |
| Portal next-period changes for every tier/interval pair | Not observed; self-service switching stays disabled | Keep contact fallback; do not enable switching |
| Provider dispute signal or tested dashboard-to-local suspension | Not observed against Polar | Block paid checkout until a working suspension path is tested |
| Supporter offer acceptance | No written acceptance recorded | Block both Supporter intervals and changes to Supporter |
| Supporter private channel and membership controls | No channel/membership evidence recorded | Block Supporter purchase |
| Configured self-hosted LiveKit end-to-end checks | Not observed in this task | Block paid voice claims until verified |
| Deployment destination, secret configuration, release artifacts | Not deployed by this task | Perform only in an authorized release |

Local tests demonstrate implementation behavior using deterministic provider fixtures. They cannot replace these provider and deployment checks. Record actual command outcomes in the release evidence described below, including failures and blocked checks.

## Catalog and tax contract

Use four distinct server-only allowlisted product UUIDs. Free has no product. Keep sandbox and production IDs and tokens separate; a name or price never identifies a user's tier.

| Mapping variable | Tier | Charge in USD cents | Product interval | Count | Upfront charge |
| --- | --- | ---: | --- | ---: | ---: |
| `POLAR_PLUS_MONTHLY_PRODUCT_ID` | Plus | 900 | `month` | 1 | $9 |
| `POLAR_PLUS_YEARLY_PRODUCT_ID` | Plus | 9000 | `year` | 1 | $90 |
| `POLAR_SUPPORTER_MONTHLY_PRODUCT_ID` | Supporter | 10000 | `month` | 1 | $100 |
| `POLAR_SUPPORTER_YEARLY_PRODUCT_ID` | Supporter | 100000 | `year` | 1 | $1,000 |

Configure a single active fixed USD price per product, recurring billing, no trial, and explicit `exclusive` tax behavior. Listed prices are before applicable checkout taxes. `location` and `inclusive` do not satisfy that contract; the catalog check rejects both. See Polar's [product configuration](https://polar.sh/docs/api-reference/products/create) and [checkout tax behavior](https://polar.sh/docs/api-reference/checkouts/get-session). Verify actual buyer-country checkout presentation before launch. Do not infer tax handling from a product display name or an organization default.

Yearly means a recurring full upfront yearly payment with yearly auto-renewal. Show the full annual total prominently. "2 months free" means 16.67% savings relative to twelve monthly payments. There is no coupon, installment plan, lifetime product, usage charge or automatic overage. Both intervals grant identical caps. Annual purchase and interval changes never reset counters or grant a year of voice minutes upfront.

Run the read-only check in a shell with an injected sandbox-only secret environment:

```sh
pnpm -C api billing:check
```

The command reads `POLAR_ENVIRONMENT`, `POLAR_ACCESS_TOKEN` and the four product variables. It defaults to sandbox, accepts only `sandbox` or `production`, performs only product GET requests to a fixed Polar host, refuses redirects, and exits nonzero for missing configuration, unreadable products, malformed responses or any mismatch. It does not need the database, does not load `.env` automatically, and never creates or updates products. Do not paste tokens into command arguments or chat. Load secrets using the release environment's secret manager. The report includes tier/interval labels and mismatch fields, not provider bodies, IDs or credentials.

A passing audit confirms product configuration only. Run it again against the explicitly selected production environment during the authorized release, with the production mappings, before purchases are enabled.

## Configuration and active deployment path

`docker-compose.local.yml` is the current local Fastify deployment path. Its `api` service loads `api/.env` and overrides database/Redis/agent hostnames and `API_VERSION_PREFIX=v1`. The current bare-container API default has no version prefix. Register the webhook with the actual externally routed prefix, rather than assuming `/v1` everywhere. The web API base URL and voice worker prefix must match.

The old `infrastructure/k8s/base/backend-deployment.yaml` and legacy AWS infrastructure target the deprecated stack. They are not a source of Fastify billing configuration. Before an authorized cloud release, inspect the actual target's service settings, image revision, API prefix, ingress body handling, secret store and job scheduling. This task does not establish a production destination by editing an old manifest.

| Setting | Operator use |
| --- | --- |
| `BILLING_ENABLED` | Enables new paid purchases. Start false; disabling does not revoke paid access or stop webhooks/reconciliation. |
| `POLAR_ENVIRONMENT` | `sandbox` for testing, `production` only for the authorized release. |
| `POLAR_ACCESS_TOKEN` | Server-only token with required checkout/customer/subscription/order/dispute reads and operations. Use least privilege supported by Polar; never expose through `NEXT_PUBLIC_*`. |
| `POLAR_WEBHOOK_SECRET` | Server-only signing secret for this environment's webhook endpoint. |
| Four `POLAR_*_PRODUCT_ID` values | Exact mappings above; never accept arbitrary IDs from the browser. |
| `SUPPORTER_CHECKOUT_ENABLED` | Separate acceptance gate, false until provider approval and channel verification. |
| `SUPPORTER_CHANNEL_URL` | Private channel URL, exposed only to verified Supporters. A hidden URL alone does not enforce membership. |
| `BILLING_CONTACT_URL` | Higher-limit and unavailable-plan contact destination, normally `/contact`. |
| `REDIS_URL` | Shared quota counters required for multiple API instances. Use persistent Redis and retain keys through their quota window. |
| Free limit and window settings | Preserve deployed unprefixed overrides. Default session/message windows are six hours. |
| Five `PRO_*` settings | Paid caps shared by Plus/Supporter, shown below. |

Approved paid settings are `PRO_SESSIONS_CREATE_MAX=100`, `PRO_CHAT_MESSAGES_MAX=3000`, `PRO_CUSTOM_SIMULATIONS_MAX=250`, `PRO_CUSTOM_PERSONAS_MAX=250`, and `PRO_VOICE_DAILY_MINUTES_PER_USER=720`. Values must be positive safe integers within storage bounds and at least the effective Free caps. A zero unlimited Free voice cap is incompatible with finite paid quotas. Voice resets at midnight UTC. Custom simulation/persona caps count owned, non-deleted inventory including drafts, rather than monthly creation credits.

Quota-storage failures must block new expensive work with a retryable error. Burst limiter fallback is not permission to bypass subscription quotas. Catastrophic Redis data loss can reset a window; these counters are application limits, not a financial ledger. Retain saved records through downgrade, and block only new inventory until the owner is below the effective cap.

## Provider identity and signed events

Use the immutable CareerSim user UUID as Polar's external customer ID. Email changes do not change billing ownership. Never map access by email, product name, checkout return, price paid or client metadata. Billing account, refresh and portal requests must use the authenticated user's UUID. Do not log portal/checkout bearer URLs.

Configure the public billing webhook at `{API_VERSION_PREFIX}/billing/webhook` on the API origin. Preserve the exact raw request bytes through ingress and Fastify. Validate Standard Webhooks signatures with the environment's signing secret before mutation; parsed-and-reserialized JSON is not the signing payload. Persist event identities and synchronize under the account lock so duplicates and reordered payloads cannot apply an older snapshot.

Subscribe to the customer/subscription/order event types consumed by the installed adapter. Treat events as triggers to retrieve authoritative customer, subscription and order state. A `subscription.created`, cycle event or checkout redirect alone never proves payment. A successful paid order with the matching recognized subscription and real period boundaries establishes the paid period. Refund state belongs to its order/period; historical refunds must not erase newer paid access.

The adapter targets `@polar-sh/sdk` 1.0.2 and API version 2026-10. Its generated types expose order item `start_timestamp` / `end_timestamp` for paid periods and `disputes.read` with order-filtered dispute iteration. Only a provider-confirmed paid order establishes payment; for disputes, only `won` can restore still-valid disputed access, while open or unknown states suspend it and lost states revoke it. These are implementation contracts, not observed sandbox outcomes.

Record configured event names, signed fixture replay outcomes and redacted real sandbox observations before launch. No real provider event has been observed during this task. Confirm the token has dispute-read permission and that the deployed adapter retrieves current disputes on reconciliation even if no dedicated dispute webhook exists. If a required signal cannot actually be read, keep the gate blocked until a tested dashboard-to-local suspension operation exists. Do not claim that cancellation alone suspends already paid access.

## Lifecycle and recovery

| Situation | Required access behavior | Operator check |
| --- | --- | --- |
| New account / unpaid initial checkout | Free, no grace | Checkout return remains pending until verified payment |
| Verified paid order | Paid through its actual period end | All five paid caps; same existing counters |
| Failed renewal after a paid period | Three-day grace after paid-through, then Free | No indefinite extension during provider outage |
| Voluntary cancellation | Retain paid access through paid-through, then Free | No failed-payment grace for cancellation |
| Explicit immediate revocation | Remove paid access immediately | Synchronize authoritative state |
| Full refund of current period | End corresponding access immediately | Ensure subscription is ended using authorized provider operations |
| Partial or historical refund | No revocation of newer paid access by refund alone | Replay both event orders |
| Open current-period dispute | Suspend paid access | Restore only after confirmed merchant win while period remains valid |
| Lost dispute | Revoke disputed access | Keep unrelated newer-period facts intact |
| Provider outage | Use stored verified access only until paid-through/grace deadline | Keep retrying synchronization; no new fabricated grant |
| Database outage | Service error | Never silently downgrade or grant access |

Periodically reconcile provider state even when no webhook arrives, and offer authenticated refresh after checkout. The runtime reconciliation job and cadence must be enabled on every released API deployment according to its configuration; use the per-account lock to serialize updates. Monitor reconciliation errors, last successful sync time, queued webhook failures and duplicate subscriptions. A stale webhook payload must trigger a fresh provider read rather than overwrite newer state.

For stale state, first verify the configured environment and the user's immutable UUID. Inspect the private provider dashboard for the current subscription and paid orders, then run the authenticated refresh or the reconciliation job. Compare paid period, recognized product, cancellation, refund and pending-change facts. Retry failed event processing only after fixing the cause. Do not edit paid-through timestamps to manufacture access, clear counters, or attach another customer's subscription. Unexpected multiple active provider subscriptions require operator review; never sum their caps.

Refunds, cancellations, revocations and dispute handling are payment operations requiring the corresponding release/operator authorization. After an authorized provider action, refresh authoritative local state, verify the affected order/period and confirm quota access. Preserve an audit record without payment credentials. Cancellation is not a substitute for an immediate dispute suspension.

Self-service tier and interval changes stay unavailable until sandbox proves the adapter can schedule one combined replacement with `next_period` and no proration or overlapping subscription. Test monthly-to-yearly, yearly-to-monthly and every tier transition. Confirm the next full charge and effective date before confirmation, preserve current benefits through the paid period, and retain the contact fallback for unsupported combinations. Configure the Polar organization portal policy for `next_period`; customer session creation cannot force that policy. Disable portal product switching while sandbox validation is missing or Supporter remains gated. A direct portal switch must not bypass the Supporter eligibility gate. Portal access for invoices, payment methods and cancellation must remain available to existing subscribers when new purchases are disabled.

## Manual Supporter membership

Do not send invitations during implementation. Before enabling Supporter, choose a private channel with actual membership controls and an operator responsible for the initial cohort.

1. Check the authenticated user's verified Supporter entitlement and current paid/grace deadline in CareerSim. A forwarded link, checkout screenshot or email address is insufficient.
2. Match the channel identity to the immutable user UUID using an authenticated support exchange. Record only the minimum identity mapping in the operator's restricted log.
3. Grant membership manually, record the verified period and provide the configured channel instructions. Honor the three benefit lines above without promising equity, a veto, guaranteed delivery or a fixed response-time SLA.
4. Review membership on entitlement changes and on a regular operator schedule. Remove access promptly after expiry, revocation, full current-period refund or open/lost dispute. Cancellation alone retains membership through paid-through.
5. Recheck current entitlement before restoring membership after a dispute or renewal. Confirm that a removed account cannot rejoin using an old URL. Keep support guidance available through the standard contact route while billing is resolved.

## Rollout and rollback

1. Back up Postgres and verify additive migration execution on the release database. Keep both purchase flags false.
2. Apply billing/voice schema migrations. Do not remove existing tables or saved records.
3. Build the compatible host extension contract and creator source revision together. Record both repository SHAs. Never patch `extensions/installed` generated copies as the source change. Test production builds with plugins enabled and disabled.
4. Release the compatible API, agent voice worker and web artifacts. Verify shared Redis and runtime reconciliation, signed raw-body webhooks and immutable UUID mapping. Keep checkout disabled while existing paid-state processing operates.
5. Complete the sandbox matrix, local verification and privacy-safe browser evidence below. Verify LiveKit against its configured self-hosted endpoint, not only a mocked client.
6. During the authorized release, audit the separate production product mappings and enable Plus purchases only when all Plus gates pass.
7. Enable Supporter separately after written eligibility acceptance, working private membership controls and both interval checks. Never enable it merely because Plus works.

During an incident, disable new purchases with `BILLING_ENABLED=false`, and disable new Supporter selections separately if needed. Keep entitlement resolution, signed event processing, reconciliation and existing-customer portal access running. This kill switch must not downgrade existing subscribers. Roll back only to a build that understands stored billing entitlements and the compatible plugin contract. Keep migrations additive; do not drop the billing/voice tables or restore code that collects payments but ignores access. If compatible rollback is unavailable, hold checkout closed and forward-fix.

## Evidence to collect before launch

For each row, record date, sandbox environment, host/plugin revisions, command or precise action, expected outcome, actual outcome, and a redacted artifact reference. Use `blocked` when credentials, a signal or provider acceptance are missing. Never turn an unperformed step into `passed`.

| Sandbox exercise | Expected observation | Observed outcome |
| --- | --- | --- |
| Read-only four-product audit | All four exact prices/cadences/tax settings match | Blocked; no supplied sandbox credentials/mappings |
| Initial purchase for all four mappings | Only verified payment activates correct tier; paid caps identical | Not run |
| Unpaid initial checkout | Free, no grace | Not run against Polar |
| Failed paid renewal | Three-day grace then Free using injected clocks where needed | Not run against Polar |
| Monthly and yearly cancellation | Access ends at real paid-through; no grace | Not run against Polar |
| Every tier/interval scheduled replacement | One `next_period` change, no immediate charge or overlap | Not run; self-service switching disabled |
| Paid yearly renewal | Actual provider boundaries extend access; counters unchanged | Not run against Polar |
| Valid signed event, duplicate and reversed replay | Idempotent fresh synchronization; forged signature rejected | Not run against Polar |
| Missing event and provider outage | Reconciliation catches up; stored access expires within bounds | Not run against Polar |
| Full current-period, partial and historical refunds | Only current fully refunded access revoked | Not run against Polar |
| Open, won and lost dispute | Suspend/restore/revoke the correct paid period | Blocked until real signal or local suspension path tested |
| Two tabs and duplicate provider subscription | Pending checkout reused/conflict; no summed entitlement | Not run against Polar |
| Portal after purchase kill switch | Existing invoices/payment/cancellation work; gated Supporter unreachable | Not run against Polar |

Run the full API suite, typecheck and lint; web suite, typecheck and lint; creator source suite/typecheck; the planned Python voice suites; and enabled/disabled plugin production builds. The task coordinator records exact local outputs and limitations. Deterministic integration tests should use a real isolated DB/Redis and test-only credentials, not a live charge.

Inspect pricing/account/contact at desktop/mobile widths in light/dark mode, keyboard navigation, both intervals and all three tiers. Capture all five visible limits, three Supporter benefit lines, clear annual total and renewal terms, unavailable-action explanation and personal contact without company. Intercept the contact destination rather than emailing a real recipient. Never include card/customer data in screenshots.

The configured LiveKit check must cover a call surviving initial token expiry, reconnect, one-active-call enforcement, worker/API failure cutoff within documented bounds, delayed deduplicated checkpoints and injected UTC rollover. See [VOICE_MODE.md](../VOICE_MODE.md) for token, checkpoint and cutoff settings. A Python unit test alone does not establish the deployed reconnect path.

Monitor active users by tier, usage cap encounters, provider costs, voice minutes, webhook verification/processing failures, billing staleness and reconciliation errors. High allowances do not guarantee that subscription revenue covers every user's model costs. Investigate cost drift without silently reducing the approved caps.
