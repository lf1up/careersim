# CareerSim subscription tiers

Date: 2026-11-10
Status: Approved by the user on 2026-11-10, with Supporter benefit wording clarified in the approval. No product implementation or live payment setup performed.

## Intent and agreed decisions

Keep CareerSim accessible while giving paying users generous, clearly disclosed practice allowances. Revenue should help sustain the project; maximizing revenue is not the goal.

The user selected three tiers:

| Tier | Monthly price | Annual price, paid upfront | Product access |
| --- | --- | --- | --- |
| Free | $0 | $0 | Existing free allowances |
| Plus | $9 USD | $90 USD | High usage caps explicitly listed on the pricing page |
| Supporter | $100 USD | $1,000 USD | Same usage allowance as Plus, plus guidance and support from the development team, direct chat, and deciding the project's future together |

The user approved the monthly prices, annual billing option, annual prices, and five paid limits. Annual billing charges for 10 months and provides 12 months of access, saving 16.67% against 12 monthly payments.

Both paid tiers use the requested `PRO_` environment-variable prefix. There is no separate Pro product or fourth tier. Application tier identifiers are `free`, `plus`, and `supporter`.

Polar is the selected billing provider. Both paid tiers offer monthly and yearly billing. This release has no tokens, prepaid packs, donations, or free trials.

## Approaches considered

1. Subscription only: straightforward purchasing and predictable charges, but less flexible for occasional users.
2. Credits only: explicit prepaid spending, but adds a spending decision to practice.
3. Subscription plus packs: flexible, but requires additional balance accounting and product choices.

The user selected subscription only for now, with the three tiers above. Earlier suggested prices for packs and measured monthly allowances are superseded by this decision.

## Current implementation

The active services are `api/`, `web/`, and `agent/`. Legacy Stripe code in `backend/` is not the integration target.

Repository defaults, not verified production settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SESSIONS_CREATE_MAX` | 2 | New sessions per configured window, currently 6 hours |
| `CHAT_MESSAGES_MAX` | 350 | User text messages across sessions and playgrounds per configured window, currently 6 hours |
| `CUSTOM_SIMULATIONS_MAX` | 3 | Owned, non-deleted custom simulations |
| `CUSTOM_PERSONAS_MAX` | 10 | Owned, non-deleted custom personas |
| `VOICE_DAILY_MINUTES_PER_USER` | 60 | Voice minutes per UTC day |

The host configures text and session limits at service startup. Voice also captures one global cap, and currently derives token lifetime and debit clamps from it. These must become user-aware without making tokens excessively long-lived.

Creator functionality comes from `lf1up/careersim-studio`, locally available at `/Users/lf1up/Projects/careersim-studio/plugins/creator`. Installed files under `extensions/installed` are generated copies, not the source to edit. Creator simulation creation calls `limitsFor(userId)`, but this currently ignores the user. Persona creation and displayed allowances also use service-level limits. All must use the same host entitlement lookup.

## Agreed paid caps

The user specified these numbers on 2026-11-10, replacing all earlier suggested caps. Preserve existing unprefixed settings for Free, including deployment overrides. Both paid tiers, on either billing interval, resolve to the same finite positive limits:

| Paid environment variable | Value | Accounting unit |
| --- | ---: | --- |
| `PRO_SESSIONS_CREATE_MAX` | 100 | Per existing `SESSIONS_CREATE_WINDOW`, currently 6 hours |
| `PRO_CHAT_MESSAGES_MAX` | 3,000 | Per existing `CHAT_MESSAGES_WINDOW`, currently 6 hours |
| `PRO_CUSTOM_SIMULATIONS_MAX` | 250 | Owned, non-deleted records |
| `PRO_CUSTOM_PERSONAS_MAX` | 250 | Owned, non-deleted records |
| `PRO_VOICE_DAILY_MINUTES_PER_USER` | 720 | Per UTC day, equivalent to 12 hours |

Paid caps must be positive safe integers, meet database arithmetic bounds, and be at least the effective Free limits. An unprefixed voice value of zero currently disables the quota; reject that combination when finite paid quotas are enabled rather than making Free more permissive than paid. Do not use zero or infinity to express paid access.

Keep burst rate limits, authentication checks, one-active-call enforcement, moderation, input limits, and infrastructure protections for every tier. A subscriber does not bypass these controls.

Lead pricing with the actual allowances rather than an "Unlimited" or "zero limits" claim. List all five caps prominently alongside benefits on each paid card or an immediately visible comparison table; do not hide them in tooltips, an FAQ, or fine print. Show exact current limits and reset information in the account usage details too. Future reductions require updated terms and clear advance notice, not a silent change to an advertised promise.

## Product experience

Present three pricing cards, with Plus as the primary upgrade and a Monthly / Yearly billing toggle. Default to Monthly; switching to Yearly does not change allowances. Show billing interval, full amount charged now, renewal terms, currency, tax treatment, and cancellation terms before checkout. Price treatment: the listed prices are before applicable checkout taxes; confirm market presentation before launch.

The paid benefits list must visibly include 100 new sessions per 6 hours, 3,000 text messages per 6 hours, up to 250 saved custom simulations, up to 250 saved custom personas, and 720 voice minutes per UTC day. Explain that saved-item caps are inventory limits, not daily/monthly creation credits. Show core scenarios, feedback, and history alongside those limits; Supporter also prominently shows guidance and support from the development team, direct chat with developers, and collaborative decisions about the project's future. Free displays its effective configured allowances and core benefits.

Read public plan limits and window labels from a safe server-owned plan catalog derived from the same configuration used for enforcement. Do not publish environment variable names, credentials, or internal configuration to the pricing UI. If the configured windows change, the pricing labels must change with them. Apply this contract to any pricing shown by `web/` or `landing/`, using a public catalog response or build-time generation as appropriate.

Place this notice below the tier comparison: "Need higher limits? Contact us to discuss your needs." Link it to a personal contact page reusing the existing contact delivery, CAPTCHA, and rate-limit infrastructure. The current business form requires a company; personal support requests must not require one. Keep business-form validation intact. Also show the contact action when a paid user reaches a cap. This requests a discussion, not an automatic cap increase, fourth tier, or custom pricing system.

## Annual billing

Approved pricing and display:

| Tier | Upfront annual charge | Monthly equivalent | Savings against 12 monthly payments |
| --- | ---: | ---: | ---: |
| Plus | $90 | $7.50 | $18, or 16.67% |
| Supporter | $1,000 | About $83.33 | $200, or 16.67% |

Use "2 months free" for the discount label. The annual total and "billed yearly" must be prominent; the monthly equivalent is secondary and must not imply monthly installments. It is a recurring annual subscription with the full year's payment collected at checkout, not a one-time lifetime purchase. Show yearly auto-renewal explicitly and allow cancellation of renewal while retaining access through the paid year.

Annual billing changes payment cadence only. Session/message windows, daily voice resets, and saved-item caps remain the same. Do not multiply allowances by 12, grant a year's voice minutes upfront, accumulate unused daily minutes, or reset counters when the interval changes. Paid-through access uses Polar's actual period boundaries, not a hardcoded 365-day offset.

Map four server-allowlisted Polar products to `(tier, interval)`: Plus monthly, Plus yearly, Supporter monthly, and Supporter yearly. Polar documents separate products for recurring billing intervals. Free requires no paid product. Supporter's eligibility flag covers both intervals. Annual totals are fixed product prices; no coupon is required for the built-in discount.

Interval-switch policy: monthly-to-yearly and yearly-to-monthly changes take effect at the next renewal, with the date and next charge displayed before confirmation. A new Free user can buy the annual plan immediately. Existing subscribers retain their current paid period; do not collect a second overlapping annual subscription. Combine any tier and interval change into one scheduled replacement. Verify all combinations in Polar's sandbox; use the existing contact fallback if scheduling cannot be supported reliably.

## Account and cap experience

Free users retain core scenarios, feedback, history, and current capabilities. At a free cap, explain when usage resets or which stored object count was reached, then offer Plus. Supporter is optional and must not appear necessary for better AI quality or additional usage.

Paid users who hit a technical cap receive the cap/reset explanation and a support route. Do not upsell Plus users to Supporter for more allowance, since both have the same allowance.

An account billing section shows current tier, billing status, renewal/access-end date, usage details, and a link to Polar's customer portal. A successful checkout redirect shows pending activation until the API verifies the purchase; returning from checkout alone never grants access.

## Supporter benefit and eligibility

The user explicitly requested guidance and support from the development team, the ability to chat with developers, and the ability to decide the project's future together. This is substantive participation in roadmap and priority discussions, not merely an anonymous suggestion box.

Use these three visible Supporter benefit lines on pricing and account pages:

- "Guidance and support from the development team"
- "Chat directly with the developers"
- "Help decide the project's future together"

Deliver guidance about using CareerSim and discussing needs through a private discussion channel. Supporters and developers discuss ideas, tradeoffs, and roadmap priorities together. No voting platform is required in v1. The promise does not imply equity, a unilateral veto, guaranteed delivery of every requested feature, or a fixed response-time SLA. Do not dilute the approved benefits to a badge or generic feedback form.

Use a configurable channel URL plus membership instructions behind verified Supporter access. The exact channel provider is left to the project owner before launch; building a community platform or messaging integration is outside this release. Manual membership verification/removal is acceptable for the initial cohort, with a documented operator checklist. A hidden link alone is not membership enforcement. No invitations or messages are sent as part of this planning work.

Polar's current Acceptable Use Policy, effective October 1, 2026, lists donations, community access, and sponsorship among prohibited categories. The proposed Supporter benefit may fall within these categories. Selling it as a SaaS subscription does not automatically resolve that issue.

Prepare all three tiers in the design and internal model, but keep Supporter checkout disabled until Polar explicitly accepts the described offer. Show it as unavailable or coming soon while disabled, never as a working checkout. Obtain written clarification using the actual price and benefits. Do not silently replace the benefit or route to another provider. If rejected, the owner must decide whether to change the offer or provider; Plus can launch independently. No request to Polar is sent without explicit authorization.

## Entitlement ownership and persistence

The API owns a single entitlement resolver keyed by authenticated user ID. It returns the tier, effective five limits, and Supporter access. Plugin services receive this resolver through the host extension contract instead of querying Polar or introducing a second billing model. Resolve on each quota-sensitive action; never rely on a long-lived JWT tier or frontend assertions.

Persist Polar customer/subscription identifiers, recognized product mapping, billing interval, provider state, paid-through time, renewal/cancellation information, pending tier/interval changes, last synchronization time, and webhook processing state in Postgres. A new user has Free access without needing a Polar customer. Use the immutable CareerSim user UUID as Polar's external customer ID; email changes do not change ownership.

Only server-configured, allowlisted Polar product IDs map to a Plus/Supporter tier and monthly/yearly interval. The server validates the selected pair and resolves its product; the client cannot submit a price or arbitrary product ID. Do not infer access from amount paid, product display name, or checkout metadata supplied by the client. Keep sandbox and production mappings/credentials separate.

Enforce one intended subscription per account. Serialize checkout creation, reuse valid pending checkout where appropriate, and send existing subscribers to plan management. Unexpected duplicate provider subscriptions must be surfaced for reconciliation, not summed into extra allowances.

## Checkout and billing lifecycle

1. An authenticated user chooses an allowed tier and billing interval. The API creates hosted checkout tied to their UUID and a server-selected product for that pair. Supporter also requires its launch flag for either interval.
2. Verify webhook signatures against raw request bodies. Store event identity and process idempotently. Reject invalid signatures before mutation.
3. Treat provider events as synchronization triggers. Fetch authoritative customer/subscription state, serialize synchronization per account, and apply only recognized purchases. Reordered event payloads cannot restore older access.
4. A verified successful initial payment grants the purchased tier. `subscription.created`, checkout return, or a cycle event alone is not proof of payment.
5. Renewal extends paid-through access only when the renewal payment is verified. Payment-failure policy: a three-day grace period after previously paid access ends, then Free. Initial unpaid checkouts receive no grace.
6. Cancellation at period end retains paid access until the paid-through time. Grace applies only to failed renewal payments, never voluntary cancellation or explicit revocation. Immediate revocation removes access immediately. Full-refund policy: a full refund of the current access period ends its subscription and revokes the corresponding access; a historical-period refund or partial refund alone does not remove newer paid access. Dispute policy: an open dispute on the current access period temporarily suspends paid access; restoration requires provider confirmation that the dispute is resolved in the merchant's favor and the paid period is still valid. A lost dispute revokes the disputed access. These are approved product policies, not payment actions authorized during planning; verify transitions in Polar's sandbox.
7. Tier and billing-interval changes take effect at the next renewal without proration, including annual-to-monthly changes at the end of the paid year. Polar documents `next_period` scheduling. Display the effective date and next full charge, keep the current benefits until then, and verify this behavior in the sandbox. If sandbox validation cannot reproduce scheduling reliably, omit the affected self-service switch in v1 and show a contact path; do not create overlapping subscriptions or a custom scheduling system as a substitute.
8. Run periodic reconciliation and offer an authenticated refresh after checkout. On provider failure, keep the last verified access only through its stored paid-through/grace deadline; do not fabricate a new grant or extend access indefinitely. Missing billing state defaults to Free; database failures are service errors, not silent downgrades.

Polar handles payment collection and its merchant-of-record checkout responsibilities. CareerSim handles access, counters, and the Supporter benefit. No usage-based charges or automatic overages are configured.

## Quota behavior and downgrade rules

Use the same usage counters when a user changes tiers. An upgrade increases the ceiling immediately after verified activation without erasing consumption. A downgrade applies the Free ceiling to existing usage. Plus-to-Supporter changes never reset counters.

Session and text quotas need atomic per-user accounting shared across API instances. In v1, consume the complete validated request count atomically at acceptance or reject without consuming a partial batch. A later model/provider failure may consume that allowance, matching the existing request-limit approach; it does not charge money. Count accepted user messages rather than assistant bubbles, judge calls, or voice transcripts. All batch, streaming, and creator playground paths use the same policy.

Reuse the existing Redis quota infrastructure for v1, with shared counters and dynamic ceilings; require Redis for multi-instance production. Quota errors must not inherit the existing fail-open burst-limiter behavior. A quota-storage failure blocks new expensive work with a retryable error rather than granting unlimited use. Configure quota-key retention/persistence appropriately and document that catastrophic Redis data loss can reset a window. These are application usage ceilings, not a financial ledger or guarantee of maximum provider spend. Durable Postgres reservations, request-level usage refunds, and abandoned-reservation recovery are deferred; they are not required to launch these subscriptions.

Count both draft and published owned custom records that are not deleted. Deleting frees an inventory slot. Serialize count-and-create per owner, including clones/imports/restores, so concurrent creates cannot exceed the cap. After downgrade, keep saved assets, editing, deletion, and access to prior work. Block new records until below the Free cap; never delete user content to enforce a downgrade. Publication and moderation rules continue unchanged.

Voice uses server-measured duration and a per-user resolved cap. Reserve one active call atomically across sessions, retain worker-authoritative debits, and make call-end replay idempotent by call identity. Add periodic cumulative duration checkpoints keyed by call identity, so retries do not double-debit and a crashed worker loses at most a bounded checkpoint interval. Split usage at UTC midnight. The worker refreshes the budget on rollover and entitlement changes; it must not continue indefinitely after a budget-fetch failure.

Separate voice credentials/token lifetime and stale-call detection from daily allowance. Choose a bounded token/reconnect policy that preserves normal calls and does not expand credential lifetime just because the paid daily cap is larger. Reuse duration checkpoints for active-call liveness; do not build a separate heartbeat subsystem. LiveKit documentation states that token expiration affects initial connection rather than an existing call, and that connected clients receive refreshed tokens. Reuse this behavior and validate the deployed reconnect path instead of adding a separate credential-renewal subsystem. Snapshot authorization for work already accepted, but re-evaluate new operations and ongoing voice budgets after access changes. Warn before a budget-driven call cutoff and persist the transcript normally.

## Build boundaries and verification

Work touches core API billing, auth/account responses, quota enforcement, voice worker budget handling, frontend pricing/account UI, and the creator plugin source. Coordinate the host extension contract and pinned plugin revision; test both plugin-enabled and plugin-disabled builds. Add `billing` to reserved plugin route names if that is the chosen host route prefix. Never patch generated installed copies as the final source of truth.

Before launch verify:

- Free, Plus, and Supporter resolve correctly across all five limits, with paid parity and immediate upgrade behavior.
- Monthly and yearly variants grant identical caps; the pricing page shows every effective cap, reset window, shared benefit, and higher-limit contact link.
- The annual toggle shows the correct full upfront total, monthly equivalent, savings, and yearly renewal terms without implying monthly installments.
- All four paid products map to the correct tier/interval; client tampering cannot substitute a cheaper product or alter price.
- Annual purchase, renewal, cancellation, failed renewal, refund, and interval/tier changes use the actual paid period, preserve usage counters, and do not create duplicate subscriptions.
- Concurrent text batches and creator creates cannot overshoot; rejected batches consume no partial quota; voice checkpoint retries do not double-debit.
- Downgrade preserves content and applies existing usage without resetting it.
- Initial purchase, renewal, failed payment, grace expiry, cancellation, scheduled tier change, refund, revocation, duplicate delivery, delayed delivery, and out-of-order events produce the expected access.
- Tampered checkout parameters, forged signatures, and unrecognized products cannot grant access.
- Voice covers simultaneous starts, reconnection, duplicate end callbacks, worker crash, entitlement change, midnight rollover, token renewal, and a missing budget service.
- Polar outages preserve only time-bounded verified access and recover through reconciliation.
- Supporter checkout remains disabled until provider eligibility and a working contact channel are confirmed.

Monitor per-tier active users, conversions, provider costs, call minutes, cap encounters, webhook failures, and stale billing state. High caps protect against extreme usage; they do not guarantee that a $9 subscription covers every user's cost. Cost measurement continues without blocking the user's chosen launch model.

## Delivery order and remaining decisions

This is a cross-service feature, not a configuration-only change. Keep the first release focused: reuse existing counters and voice infrastructure with the changes needed for per-user limits and long paid calls. Defer a general-purpose durable metering/reservation engine. The approved implementation sequence is: billing/entitlement model; shared quota and creator integration; voice handling; Polar sandbox lifecycle; pricing/account UI; rollout and monitoring. No production checkout or deployment is authorized by this design alone.

The five paid cap values, visible pricing/contact requirements, annual discount, and Supporter benefit wording are approved user decisions. The design's three-day grace, tax presentation, scheduled tier/interval changes, and refund/dispute behavior were presented as author choices and are covered by the user's approval. The exact Supporter channel remains an operator configuration before launch. Database field names, module layout, test fixtures, bounded token renewal intervals, reconciliation cadence, and adapter details are left to the builder, subject to the behavioral contracts above.

## Sources checked on 2026-11-10

- https://polar.sh/legal/acceptable-use-policy
- https://polar.sh/docs/integrate/customer-state
- https://polar.sh/docs/integrate/webhooks/events
- https://polar.sh/docs/api-reference/subscriptions/update
- https://polar.sh/docs/features/products
- https://docs.livekit.io/frontends/reference/tokens-grants/
- Host: `api/src/config/env.ts`, `api/src/plugins/rate-limit.ts`, `api/src/modules/voice/voice.service.ts`, `api/src/db/schema.ts`, `api/src/extensions/sdk.ts`, `api/scripts/plugins.mjs`.
- Worker: `agent/src/careersim_agent/voice/worker.py`.
- Plugin: `careersim-studio/plugins/creator/shared/limits.ts`, `api/service.ts`, `api/personas.service.ts`.
