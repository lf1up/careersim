# 🔌 CareerSIM API

Fastify + Drizzle + TypeScript API gateway in front of the Python `agent/`
service. The API owns all persistence (Postgres); the agent stays fully
stateless and is called fresh with the caller-owned `state_snapshot` on every
turn.

## 🧱 Stack

- **Runtime**: Node ≥22.12, TypeScript (strict ESM), pnpm
- **HTTP**: Fastify 5 + `fastify-type-provider-zod` (Zod schemas double as OpenAPI)
- **DB**: PostgreSQL 17, Drizzle ORM + drizzle-kit migrations
- **Auth**: HTTP-only session cookie for browsers, JWT bearer for other clients (`@fastify/jwt`), and argon2id password/OTP hashing.
  Email-verified registration (6-digit code), passwordless magic-link login,
  password reset, and authenticated email/password change flows
- **Email**: `nodemailer` with a dev-friendly stdout transport when SMTP is
  unconfigured (verification codes + magic links get logged to the Fastify
  logger instead of sent)
- **CAPTCHA**: [ALTCHA](https://altcha.org) proof-of-work via `altcha-lib`.
  Server issues signed challenges at `GET /v1/auth/challenge`; public-facing
  auth mutations require a solved payload
- **Rate limiting**: `@fastify/rate-limit` with Redis store (falls back to
  per-process LRU when `REDIS_URL` is unset). Global 200/min per-IP safety
  net plus per-route policies keyed by IP / email / user id. Full policy
  table in `src/plugins/rate-limit.ts`; flip off for emergencies via
  `RATE_LIMIT_ENABLED=false`
- **Upstream client**: `undici` + `eventsource-parser` for SSE proxying
- **Tests**: Vitest + Fastify `app.inject()` + `@electric-sql/pglite` + an in-process `FakeAgent` (ALTCHA and rate limits both run in off/bypass mode for the main suite, with dedicated suites that exercise them end-to-end)

## 🚀 Quick start

```bash
cd api
pnpm install
cp .env.example .env          # adjust JWT_SECRET + AGENT_API_URL as needed

# Apply migrations to the local Postgres (see docker-compose.local.yml)
pnpm db:migrate

# Dev server with hot reload on :8000
pnpm dev
```

In development mode, OpenAPI docs are exposed at `http://localhost:8000/v1/docs`. The production API omits the docs and detailed service index.

## 🛣️ Endpoints (v1)

Every versioned route — the service index, `/v1/health` readiness probe, the
docs, and the internal worker routes — lives under a version prefix controlled
by the `API_VERSION_PREFIX` env var. Empty/unset means **no prefix**
(`/auth/...`) — the bare-container default used by the current cloud setup.
Process liveness at `GET /health` is **never** prefixed, so load balancers
don't need to know the API version. Locally the rule is `v1`: `api/.env` and
`docker-compose.local.yml` set `API_VERSION_PREFIX=v1` on both the API and the
agent-voice worker, and the web app's `NEXT_PUBLIC_API_URL` (a full base URL)
carries the matching `/v1` path. The tables below show that local `v1` surface. With no prefix, `/health` remains liveness only; there is no separate readiness route. In the Auth column, `jwt` accepts either the session cookie or a bearer token.

| Method | Path | Auth | CAPTCHA | Rate limit | Purpose |
| --- | --- | --- | --- | --- | --- |
| GET  | `/health` | public | — | 200/min per IP (global) | Process liveness (no db/agent ping) |
| GET  | `/v1/health` | public | — | 200/min per IP (global) | Version readiness: db + agent + cache + voice ping |
| GET  | `/v1/auth/challenge` | public | — | 60/min per IP | Issue an ALTCHA proof-of-work challenge for the forms below |
| POST | `/v1/auth/challenge/verify` | public | ✓ | 60/min per IP | Consume a single-use solution for server-side contact forms |
| POST | `/v1/auth/register` | public | ✓ | 10/15min per IP | Start registration (password or passwordless); emails a 6-digit verification code. `202 { pending, email }` |
| POST | `/v1/auth/resend-verification` | public | — | 3/hour per email | Re-send the registration verification code. Not captcha-gated: the pending record it resends against can only be created by `/v1/auth/register`, which *is* gated |
| POST | `/v1/auth/verify-email` | public | — | 10/5min per email | Consume the 6-digit code; returns `{ user, token }` |
| POST | `/v1/auth/login` | public | ✓ | 10/min per IP | Exchange credentials for a JWT |
| POST | `/v1/auth/login/email-link` | public | ✓ | 5/hour per email | Email a magic sign-in link (passwordless) |
| POST | `/v1/auth/magic-link/consume` | public | — | 10/5min per IP | Consume a magic-link token; returns `{ user, token }` |
| POST | `/v1/auth/forgot-password` | public | ✓ | 3/hour per email | Email a password-reset link |
| POST | `/v1/auth/reset-password` | public | — | 10/5min per IP | Consume a reset token + set a new password |
| GET  | `/v1/auth/me` | jwt | — | 200/min per IP (global) | Current user |
| PATCH | `/v1/auth/me/password` | jwt | — | 10/hour per user | Rotate / set a password (current password required when one exists) |
| POST | `/v1/auth/me/email-change` | jwt | — | 5/hour per user | Start an email change; emails a 6-digit code to the new address |
| POST | `/v1/auth/me/email-change/confirm` | jwt | — | 10/5min per user | Consume the code + swap the email |
| GET  | `/v1/simulations` | public | — | 200/min per IP (global) | Passthrough to agent `GET /simulations` |
| POST | `/v1/sessions` | jwt | — | Tier allowance per configured window | Create session → `POST /conversation/init` → persist |
| GET  | `/v1/sessions` | jwt | — | 200/min per IP (global) | List caller's sessions with message counts |
| GET  | `/v1/sessions/:id` | jwt (owner) | — | 200/min per IP (global) | Persisted messages + latest analysis/goal progress |
| GET  | `/v1/sessions/:id/report` | jwt (owner) | — | 10 / 5 min per user | LLM debrief report (skill scores, tone journey, advice, key moments). Cached per transcript length; regenerated via agent `POST /conversation/debrief` when the conversation advances. `400 NO_USER_MESSAGES` before the first user message; `400 OPEN_CONVERSATION` for unscored conversations |
| POST | `/v1/sessions/:id/messages` | jwt (owner) | — | 60 requests/min + shared text allowance | `POST /conversation/turn` → persist delta |
| POST | `/v1/sessions/:id/messages/stream` | jwt (owner) | — | 60 requests/min + shared text allowance | SSE proxy of `POST /conversation/turn/stream`; persists each message before forwarding, then final evaluation on `done` |
| POST | `/v1/sessions/:id/proactive` | jwt (owner) | — | 30/min per user | Batch followup (`trigger_type: "followup"` only) |
| POST | `/v1/sessions/:id/proactive/stream` | jwt (owner) | — | 30/min per user | SSE followup (`trigger_type: "followup"` only) |
| POST | `/v1/sessions/:id/nudge` | jwt (owner) | — | 120/min per user | Guarded inactivity nudge (batch only) |
| POST | `/v1/sessions/:id/voice/start` | jwt (owner) | — | 10/min per user | Mint a LiveKit join token. `503 voice_disabled`, `429 voice_quota_exhausted`, `409 voice_call_in_progress` |
| POST | `/v1/sessions/:id/voice/end` | jwt (owner) | — | 20/min per user | End the identified `call_id` and terminate its room. Duration debit comes from worker checkpoints |
| GET  | `/v1/simulations/:slug` | public or provider-controlled | — | 200/min per IP (global) | Catalog detail; namespaced plugin slugs use the provider's visibility rules |
| GET  | `/v1/personas` | jwt | — | 200/min per IP (global) | Public-safe persona summaries |
| GET  | `/v1/personas/:slug/avatar` | public | — | 200/min per IP (global) | Catalog persona avatar |
| POST | `/v1/auth/logout` | optional session | — | 200/min per IP (global) | Revoke current stored session and clear its cookie, including when credentials are expired or absent |
| GET  | `/v1/analytics/overview` | jwt | — | 200/min per IP (global) | Aggregate practice stats across all the caller's sessions: deterministic totals (sessions, goals, completion rate, practice time, voice usage) plus skill averages / score trend / tone distribution derived from cached debrief reports |

Email confirmation accepts an optional `password` alongside `email` and `code`.
Password-based clients must submit the password chosen by the user at this step;
the web registration and unverified-login forms do so from their in-memory state.
Confirmation without a password, or a magic-link sign-in that first verifies an
account, leaves it passwordless rather than activating a password supplied before
email ownership was proven. Existing verified accounts keep their passwords. All verification codes
and sign-in/reset links are redeemed with an atomic, single-use database update.
Passwordless users can set a password later through `PATCH /auth/me/password`.

### 🎙️ Internal voice routes (worker ⇄ API)

These routes use `X-Internal-Key` with a nonempty matching `AGENT_INTERNAL_KEY` and are hidden from OpenAPI. Voice state, budget, checkpoint, and end routes return `503 voice_disabled` when voice is disabled. The internal message route requires the shared key independently of that switch. Limits are 30/min per session, or per call for checkpoints.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/internal/sessions/:id/state-for-voice` | Fresh wire-format `state_snapshot` for a room join |
| GET | `/v1/internal/sessions/:id/voice-budget` | Remaining tier-specific daily seconds, UTC usage date, and next reset |
| POST | `/v1/internal/sessions/:id/messages/stream` | Persist a spoken user turn and stream its reply without a user JWT or text-quota debit |
| POST | `/v1/internal/voice/calls/:callId/checkpoint` | Deduplicate cumulative duration, debit UTC usage buckets, renew the call lease, and return continuation authorization |
| POST | `/v1/internal/sessions/:id/voice/end` | Finalize aggregate voice analysis for the identified call; no duration debit |

### 💳 Billing routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/billing/catalog` | public | Free, Plus, and Supporter prices, limits, benefits, and availability |
| GET | `/v1/billing/account` | jwt | Effective entitlement, paid period, status, and five usage metrics |
| POST | `/v1/billing/checkout` | jwt | Start or reuse hosted Polar checkout for an allowlisted tier and interval |
| POST | `/v1/billing/refresh` | jwt | Synchronize provider state and return the account |
| POST | `/v1/billing/portal` | jwt | Hosted payment, invoice, and cancellation management |
| POST | `/v1/billing/change` | jwt | Currently rejects self-service changes; clients use contact fallback |
| GET | `/v1/billing/supporter` | jwt, Supporter | Private-channel instructions for verified Supporters |
| POST | `/v1/billing/webhook` | signed Polar event | Verify raw-body signature, store event identity, and refresh authoritative provider state |

Checkout, refresh, portal, and change routes have a 6/min per-user operation limit. The webhook has a 120/min limit.

The CAPTCHA-gated endpoints accept an optional `altcha` field (the solved
challenge payload) in the JSON body. It is **required in production** and
bypassed only when the app is built with `altcha.bypass = true` (tests).

When a limit is exceeded the server responds `429 Too Many Requests` with
`Retry-After`, `X-RateLimit-*` headers, and a JSON body shaped like:

```json
{
  "error": "RATE_LIMITED",
  "message": "Too many requests. Try again in 1 minute.",
  "retryAfter": 59995
}
```

`retryAfter` is in milliseconds. The full policy table (and the three
keyers — IP, email-from-body, authenticated user id) lives in
`src/plugins/rate-limit.ts`.

## 💳 Subscriptions and quotas

The API owns Polar billing state and derives entitlements from stored, verified paid periods. `BILLING_ENABLED=false` blocks new purchases by default, while existing access, portal management, signed webhooks, and configured reconciliation continue. Supporter becomes available when billing, both Supporter product mappings, and `SUPPORTER_CHANNEL_URL` are configured. Self-service tier/interval changes remain disabled.

Five limits are independent:

| Limit | Free default | Plus default (`PRO_*`) | Supporter default (`SUPPORTER_*`) |
| --- | ---: | ---: | ---: |
| Session starts per session window | 2 | 100 | 200 |
| Text messages per chat window | 350 | 3000 | 6000 |
| Owned custom simulations | 3 | 250 | 500 |
| Owned custom personas | 10 | 250 | 500 |
| Voice minutes per UTC day | 60 | 360 | 720 |

Session and chat windows each default to six hours and start with the first admitted action. Counters stay attached to the user across tier or billing-interval changes. Accepted submission attempts count even if later generation fails. Text batches count every item and must fit the remaining allowance in full. Internal voice turns use the voice allowance instead of the text allowance. Redis shares session/chat counters across instances; without it they are process-local. Quota-store failures reject expensive work.

Custom inventory is reported by the optional creator plugin through extension API v2. Caps count owned, non-deleted records, including drafts. Downgrades retain existing records and block new inventory above the effective cap. Monthly and yearly plans grant the same limits.

Prices are API configuration in USD cents: `PRO_MONTHLY_PRICE_CENTS=900`, `PRO_YEARLY_PRICE_CENTS=9000`, `SUPPORTER_MONTHLY_PRICE_CENTS=5900`, and `SUPPORTER_YEARLY_PRICE_CENTS=59000`. `PRO_*` maps to Plus. Changing these values does not change Polar products.

Signed events enter a durable inbox and trigger a fresh provider read. Reconciliation runs every five minutes when a provider token is configured, with retries for failed synchronization. Paid access lasts through the verified paid period. Failed renewals can receive 72 hours of grace; voluntary cancellation does not. Refunds, revocation, and disputes affect access according to the verified period. Checkout return alone never grants paid access.

See the [billing runbook](../docs/BILLING.md) for product mappings, provider audit, lifecycle rules, and rollout checks. `pnpm billing:check` audits configured product prices and cadence read-only; it does not load `.env` automatically or exercise payments.

## 🔌 Optional plugins

The API host accepts extension API v2 plugins selected by `CAREERSIM_PLUGINS`. The creator source is in the separate private `careersim-studio` repository. Plugins receive authentication, agent, database, and entitlement services, mount routes under their own ID, and apply migrations in their own schema. The host refuses incompatible API versions or colliding IDs/namespaces. See [root plugin setup](../README.md#-plugin-support) for fetch, local-watch, and Docker configuration.

## 📁 Layout

```text
api/
├── src/
│   ├── index.ts                # Server entry (listen + graceful shutdown)
│   ├── server.ts               # buildApp({ db, agent, jwtSecret }) — exported for tests
│   ├── config/env.ts           # Zod-validated env
│   ├── db/
│   │   ├── client.ts           # createPgClient / createPgliteClient
│   │   ├── schema.ts           # auth, sessions/messages, billing tables; re-exports voice usage tables
│   │   ├── migrate.ts          # drizzle-orm migrator (node-postgres)
│   │   └── migrations/         # drizzle-kit output (0002 email verification + authTokens; 0003 voice mode; 0006 cached session report)
│   ├── agent/
│   │   ├── types.ts            # Wire types mirroring agent/src/careersim_agent/api/app.py
│   │   └── client.ts           # HttpAgentClient + parseAgentSSE
│   ├── plugins/
│   │   ├── auth.ts             # @fastify/jwt + app.authenticate decorator
│   │   ├── altcha.ts           # ALTCHA: GET /v1/auth/challenge + app.altcha.verify(payload)
│   │   ├── rate-limit.ts       # @fastify/rate-limit: Redis/LRU store, keyers (IP/email/user), policy catalogue
│   │   ├── mailer.ts           # nodemailer + dev stdout fallback (app.mailer.send)
│   │   └── errors.ts           # HttpError + Zod validation mapping
│   └── modules/
│       ├── auth/               # register, verify, login, magic-link, forgot/reset, profile (change pw/email)
│       ├── health/             # GET /health liveness + GET {prefix}/health db/agent/cache/voice readiness
│       ├── simulations/        # agent passthrough
│       ├── sessions/           # create, list, get, turn (batch + SSE), proactive, debrief report (cached)
│       ├── analytics/          # GET /v1/analytics/overview — read-only aggregation over sessions + cached reports (no tables of its own)
│       ├── billing/            # Polar catalog, checkout, sync, entitlements, webhook inbox + reconciliation
│       ├── quotas/             # per-user session and text windows (Redis or memory)
│       ├── personas/           # safe summaries + public catalog avatars
│       └── voice/              # call reservations, cumulative checkpoints + UTC usage
├── tests/
│   ├── helpers/
│   │   ├── build-test-app.ts   # pglite + FakeAgent + ALTCHA bypass wiring (exports TEST_ALTCHA)
│   │   └── fake-agent.ts       # mirrors agent/tests/test_api.py _FakeGraph contract
│   ├── health.test.ts
│   ├── auth.test.ts            # register / verify / login / magic link / password reset / email + password change
│   ├── altcha.test.ts          # challenge shape, bypass semantics, real solve end-to-end, signature tampering
│   ├── rate-limit.test.ts      # disabled flag, global 429 envelope, per-email / per-user bucket isolation, burst login
│   ├── simulations.test.ts
│   ├── sessions.batch.test.ts
│   ├── sessions.stream.test.ts
│   ├── sessions.statelessness.test.ts
│   ├── sessions.report.test.ts # debrief report: generation, message-count cache, regeneration, ownership
│   ├── analytics.test.ts       # /analytics/overview aggregation + user isolation
│   └── voice.routes.test.ts    # token mint, ownership, kill switch, quota debit + concurrency guard
├── Dockerfile
├── drizzle.config.ts
├── vitest.config.ts
└── tsconfig.json
```

## 🧪 Testing

```bash
pnpm test            # vitest run (pglite + FakeAgent, no network, no OpenAI)
pnpm test:watch
pnpm typecheck
```

### 🎬 Interactive end-to-end flow

`pnpm e2e` is an older interactive CLI for an API at `BASE_URL`, with `/v1` hardcoded in its requests. It still expects registration to return a token and does not solve ALTCHA or confirm email. It cannot complete the current stock registration/login flow. Use the web UI for a real auth smoke test; the examples below document the CLI's existing flags for controlled test setups.

```bash
# zero-config: random email/password, base URL = http://localhost:8000
pnpm e2e

# use an existing account + preselect a simulation
pnpm e2e --email me@careersim.test --password hunter2hunter2 \
         --simulation behavioral-interview-brenda

# point at another environment
BASE_URL=https://staging.api.example.com pnpm e2e
```

Inside the REPL you can send free-text messages (streamed via
`/messages/stream`) or issue commands: `/followup` (streaming proactive
followup), `/nudge` (guarded inactivity nudge), `/idle <sec>` (sleep then
nudge), `/get` (reload session + persona config), `/list`, `/help`,
`/quit`. The banner printed on session create shows the persona's
`starts`, `typing` (wpm), `nudge_delay` (min–max sec), `max_nudges`, and
`burstiness` ranges taken straight from `GET /v1/sessions/:id`'s
`session_config`. A background auto-nudger polls `/nudge` every
`AUTO_NUDGE_SECONDS` (default `5`, set `0` to disable); the server, not
the script, decides when to actually fire based on the persona's
`inactivityNudgeDelaySec` window — so you observe the same behaviour as
the Gradio dev UI.

Tests cover:

- Health probe (happy + degraded agent paths)
- Auth (register + login): password + passwordless registration, 6-digit
  verification, resend, wrong/expired code, duplicate email, wrong
  password, tampered token, email normalisation, `/v1/auth/me`, change
  password, request + confirm email change
- Auth (passwordless): magic-link issuance, consumption, token
  single-use + expiry, forgot-password → reset-password round-trip
- ALTCHA: `/v1/auth/challenge` response shape, bypass mode accepting the
  test token and rejecting garbage, production mode rejecting missing /
  bogus / tampered payloads, and a real PoW solve against a live
  challenge that round-trips through `/v1/auth/register`
- Rate limiting: disabled flag is a hard no-op, global default fires a
  `RATE_LIMITED` envelope with `retry-after` once the quota burns,
  per-email bucket isolation on `/v1/auth/resend-verification`, per-user
  bucket isolation on `/v1/auth/me/password`, per-IP burst ceiling on
  `/v1/auth/login`
- Simulations: public catalog list/detail + agent passthrough; authenticated persona list
- Sessions (batch): create, get, list, ownership, unknown id, message ordering, validation
- Sessions (SSE stream): event shape, incremental message persistence, interruption, final evaluation, ownership
- Nudge guardrails: `no_human_activity`, `not_enough_idle`, `budget_exhausted`, counter reset on human reply, override floor honoured
- Proactive followup: batch + streaming paths, rejection of non-followup triggers
- Statelessness contract: two users do not bleed, DB as single source of truth, exactly one agent call per turn, deterministic replay across sessions
- Session report: `400 NO_USER_MESSAGES` before the first user message,
  generate + persist on first request, cache hit while the transcript is
  unchanged (no second agent call), regeneration after the conversation
  advances, ownership / 404 / auth, and no `version` / `updated_at` bump
  from report writes
- Analytics overview: auth required, zeroed stats for a fresh user,
  deterministic totals across sessions, goal completion rate from
  `goal_progress` snapshots, skill averages / trend / tones sourced from
  cached reports only, per-simulation breakdown, and user isolation
- Voice: token mint shape, ownership/404, kill switch, daily exhaustion, one-active-call reservation, internal-key enforcement, cumulative checkpoint accounting, UTC rollover, and final analytics merge

The agent contract is faked deterministically in `tests/helpers/fake-agent.ts` in the same style as `_FakeGraph` at `agent/tests/test_api.py:155`, so running the suite requires neither the Python agent nor an OpenAI key.

## 📣 Proactive triggers

The agent supports three proactive graph branches. The API maps them to three
distinct endpoints with different semantics:

| Trigger | API surface | Why |
| --- | --- | --- |
| `start` | Runs once inside `POST /v1/sessions` (server-side during init). | Opening lines should never be requested again from a client. |
| `followup` | `POST /v1/sessions/:id/proactive` (batch) or `POST /v1/sessions/:id/proactive/stream` (SSE). | The AI is choosing to continue speaking right after its own last message — we stream it so the frontend can replay each line with its `typing_delay_sec`. |
| `inactivity` | `POST /v1/sessions/:id/nudge` (batch only, guardrailed). | A timer fired while we're waiting for the human — the result is a single short message, there's no reason to stream it, and unbounded retries would spam the agent. |

### 👋 Inactivity nudge contract

`/nudge` is idempotent and always returns 200. The server decides whether to
dispatch to the agent based on per-session state:

- `last_human_message_at` — set on every user message.
- `last_nudge_at` / `nudge_count_since_human` — bumped when a nudge fires;
  reset by the next human message.

Skipped calls respond with a reason so the client can adjust its local timer:

```json
{ "nudged": false, "reason": "not_enough_idle", "idle_seconds": 15, "nudge_count": 0 }
{ "nudged": false, "reason": "budget_exhausted", "idle_seconds": 900, "nudge_count": 2 }
{ "nudged": false, "reason": "no_human_activity", "idle_seconds": 3, "nudge_count": 0 }
```

Successful calls return the updated session detail:

```json
{ "nudged": true, "session": { "id": "...", "messages": [...], ... } }
```

Nudge decisions are driven entirely by the persona's
`conversationStyle`, mirroring the Gradio dev UI. The API trusts whatever
the agent declared — there are no env-level guardrails to tune.

For each session the server reads the persona's
`conversationStyle.inactivityNudgeDelaySec` and `inactivityNudges` from
the state snapshot. Within the persona's `[min, max]` delay range the
server picks a deterministic threshold per silence window — seeded by
session id + baseline-activity timestamp + nudge count — so every poll
inside the same silence converges on the same firing time. The baseline
is `max(lastHumanMessageAt, lastNudgeAt)`, so after a nudge fires the
next one has to wait another full delay window instead of chaining
immediately.

If a persona doesn't declare these fields (or sets
`inactivityNudges.max` to `0`), the server fires **zero** inactivity
nudges for that session and returns
`{ nudged: false, reason: 'nudges_disabled' }` on every `/nudge` call —
clients can stop polling. The `e2e` script uses that signal to kill its
auto-nudger. All first-party personas in `agent/data/personas.json` do
declare both fields, so this is strictly an opt-out / defensive path.

## 🌱 Environment

See `.env.example` for the authoritative list. Required in production:

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_VERSION_PREFIX` | — (no prefix) | Version segment versioned routes are served under. Empty/unset → unprefixed versioned routes (bare-container / cloud default); accepts `1`, `v1`, or `/v1` equivalently. Process liveness at `GET /health` is never prefixed. Local dev + compose set `v1`. Keep it in sync with the path in the web app's `NEXT_PUBLIC_API_URL` (a full base URL) and with the agent-voice worker's `API_VERSION_PREFIX` |
| `DATABASE_URL` | — | Postgres connection string |
| `AGENT_API_URL` | — | Base URL of the agent FastAPI server (`agent/ --serve api`) |
| `AGENT_INTERNAL_KEY` | — | Shared secret sent as `X-Internal-Key` on every API ⇒ agent call. Must match the agent's `AGENT_INTERNAL_KEY`. Leave empty for single-service dev (agent accepts unauthenticated calls with a warning); set to a long random string in production |
| `JWT_SECRET` | — | Min 16 chars; rotate via deploy |
| `JWT_EXPIRES_IN` | `7d` | Passed to `@fastify/jwt` |
| `TRUSTED_PROXIES` | empty | Comma-separated ingress IP addresses/CIDRs whose forwarding headers are trusted. Configure the actual production proxy network; empty trusts no proxies. Wildcards and unrestricted `true` are rejected. |
| `CLIENT_IP_SOURCE` | `socket` | On DigitalOcean App Platform set `digitalocean` and leave `TRUSTED_PROXIES` empty. Uses the platform's validated `do-connecting-ip` header for rate limits; other hosts ignore that header by default. Signed contact visitor identity takes precedence. |
| `WEB_APP_URL` | `http://localhost:3000` | Public origin of the Next.js app. Embedded in outbound emails (magic links, password reset) |
| `CORS_ALLOWED_ORIGINS` | — | Comma-separated browser origins allowed with credentials. Empty permits any origin outside production; production requires explicit origins for cross-origin browser requests |
| `ALTCHA_HMAC_KEY` | — | Server-only secret (≥16 chars) used to sign + verify ALTCHA challenges. Rotating invalidates in-flight challenges |
| `ALTCHA_MAX_NUMBER` | `50000` | Upper bound for the PoW target. Raise under attack; lower for low-power clients |
| `RATE_LIMIT_ENABLED` | `true` | Disables burst limits and session/text quota enforcement when `false`; voice and inventory enforcement are separate |
| `REDIS_URL` | — | Optional Redis connection string (e.g. `redis://localhost:6379`). When set, rate-limit buckets are shared across API instances; otherwise the plugin uses a per-process LRU store |
| `SESSIONS_CREATE_MAX` | `2` | Free-tier session-start allowance within `SESSIONS_CREATE_WINDOW`. Paid tiers use their own caps |
| `SESSIONS_CREATE_WINDOW` | `6 hours` | Window for `SESSIONS_CREATE_MAX`. Accepts positive durations with units such as `30 minutes`, `1 hour`, or `6 hours` |
| `CHAT_MESSAGES_MAX` | `350` | Free-tier per-user text-message allowance across ordinary sessions and creator persona/simulation playgrounds. Batches count each message. Submission attempts count even if the handler subsequently fails; a batch exceeding the remaining allowance is rejected before generation. Internal voice turns are excluded. |
| `CHAT_MESSAGES_WINDOW` | `6 hours` | Duration of the text-message allowance, starting with the first send. Returns HTTP 429 with `retryAfter` (milliseconds) and `Retry-After` (seconds) when exhausted. Redis shares the allowance across API instances; without Redis it is local to each process. |
| `HOST` | `0.0.0.0` | Fastify bind host |
| `PORT` | `8000` | Fastify bind port |
| `LOG_LEVEL` | `info` | pino level |

Voice mode (the `/voice/*` surface — mirrors `VOICE_ENABLED` on the agent;
flip both together). Routes always register so the kill switch works without
a redeploy:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOICE_ENABLED` | `false` | API kill switch. The supplied `.env.example` enables it. Match the worker flag and use `NEXT_PUBLIC_VOICE_ENABLED=false` to hide the web Call button |
| `VOICE_DAILY_MINUTES_PER_USER` | `60` | Free-tier minutes per UTC day, accounted in seconds through cumulative worker checkpoints. Paid caps come from entitlements; `0` disables the Free cap and is incompatible with finite paid caps |
| `VOICE_ACTIVE_CALL_STALE_SECONDS` | `60` | Lease duration since the last worker checkpoint. Replacing a stale call first requires successful termination of its old room |
| `LIVEKIT_URL` | — | SFU URL the API mints tokens against. Must match the `livekit` + `agent` services |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | — | LiveKit credentials used to sign initial-join tokens with a 10-minute TTL, independent of the usage cap |
| `VOICE_WORKER_URL` | — | LiveKit Agents worker health base URL (`GET /`, default port 8081). Empty or voice disabled → `/v1/health` reports `voice: skipped` |

Outbound email (optional in dev — leave `SMTP_HOST` blank to log rendered
emails through the Fastify logger and read verification codes / magic
links straight from `pnpm dev` output):

| Variable | Default | Purpose |
| --- | --- | --- |
| `SMTP_HOST` | — | SMTP relay host (SendGrid, Postmark, SES, Mailgun, …). Empty ⇒ stdout fallback |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (usually port 465) |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `MAIL_FROM` | `CareerSIM <no-reply@careersim.local>` | `From:` header on outbound mail. In production, this must use a domain verified with the SMTP provider |

## 🐳 Docker

```bash
docker build -t careersim-api ./api
docker run --rm -p 8000:8000 --env-file api/.env careersim-api
```

The top-level `docker-compose.local.yml` wires `api` + `web` + `agent` +
`agent-voice` + `livekit` + `postgres` + `redis` together; on the compose
network `AGENT_API_URL` is rewritten to `http://agent:8001`. When running the
API on the host instead, point `AGENT_API_URL` at the host-published agent
port (`http://localhost:8001`).

## 🎨 Design notes

- **The agent is a pure function of its inputs.** We persist the full
  `state_snapshot` (JSONB) on every turn and never assume the agent remembers
  anything. This mirrors `TestStatelessness` in `agent/tests/test_api.py:196`.
- **Messages are reconstructed from the agent's canonical history.** On each
  turn we compute the delta between the persisted message count and the
  agent-returned `state.messages` array, then append only the new rows. The DB
  is the source of truth for reads; the snapshot is replayed back to the agent
  for writes.
- **Streaming preserves displayed turns.** Text and internal voice streams persist each message before forwarding it. The final `done` saves evaluation state. Proactive streams persist only at `done`. A disconnect aborts upstream generation; a new turn supersedes the prior in-flight turn for that session. `expected_message_count` rejects stale submissions with `TURN_CONFLICT` before generation.
- **Ownership is checked in the service layer.** Routes only destructure
  `request.user.sub`; the service throws `forbidden()` if the session's
  `user_id` doesn't match, which the error plugin maps to HTTP 403.
- **Auth secrets are hashed at rest.** Passwords and 6-digit codes use argon2id. High-entropy magic-link and password-reset tokens use SHA-256 hashes for lookup. Codes and links are consumed atomically and expire on the server. The development stdout mail transport logs rendered emails, including raw codes and links.
- **Login sessions are revocable.** JWTs carry a random session ID backed by
  `auth_sessions`. Logout revokes that session; password reset, password change,
  and email change advance the user's authentication version, invalidating all
  previous sessions, including concurrent logins verified against old credentials.
  Credential changes issue a fresh token and browser cookie. Legacy JWTs without
  a stored session are rejected.
- **ALTCHA is single-use across instances.** The widget solves a signed
  proof-of-work challenge client-side; the server re-verifies the HMAC
  and the solution with the shared `ALTCHA_HMAC_KEY`, then atomically inserts
  the challenge into PostgreSQL's `used_captcha_challenges` registry. Replays
  fail even on another API instance. Storage failures fail closed. Expired
  registry entries are pruned on successful verification. Contact forms issue
  challenges through the API and consume them through `POST /auth/challenge/verify`.
  There is no
  third-party CAPTCHA and no IP reputation service — rate-tuning is a
  matter of bumping `ALTCHA_MAX_NUMBER`. Tests set `altcha.bypass = true`
  at app build time so the existing suites don't need to solve a PoW on
  every request; a dedicated `altcha.test.ts` suite turns bypass off to
  cover the production path end-to-end.
- **Rate limiting complements ALTCHA, it does not replace it.** ALTCHA
  adds per-request cost (a few ms of client CPU); rate limiting caps
  sustained request counts. The plugin runs in `preHandler` rather than
  `onRequest` so body-keyed limits (e.g. the 3/hour quota per email
  mailbox on `/v1/auth/forgot-password`) can actually read the parsed
  body. All 429 responses are routed through the same `HttpError`
  pipeline as the rest of the API so the envelope `{ error, message,
  retryAfter }` is uniform. Buckets live in Redis when `REDIS_URL` is
  set and in an in-memory LRU otherwise — swapping stores doesn't
  change behaviour, only the sharing radius.

- **Dev email goes to stdout.** When `SMTP_HOST` is empty the mailer
  plugin falls back to a logger transport that prints the full rendered
  email, so registration / reset flows are usable locally without SMTP
  credentials.
- **Debrief reports are cached by transcript length.** `GET
  /sessions/:id/report` stores the generated report and the message count
  it was computed from (`report` / `report_message_count` on the
  `sessions` row). While the transcript hasn't advanced, the cached JSON
  is served with zero agent calls; once new messages land, the next
  request regenerates via the agent's `POST /conversation/debrief`. Cache
  misses are a large-context LLM call, so the route carries its own tight
  rate-limit policy (`sessionReport`), and report writes deliberately do
  not bump the session's optimistic-concurrency `version`.
- **Analytics are computed on read, not persisted.** `GET
  /analytics/overview` has no tables of its own — it aggregates the
  caller's sessions, messages, voice usage, and cached debrief reports at
  request time. Deterministic stats (sessions, goals, completion rate,
  practice time) cover every session; skill averages, score trend, and
  tone distribution only cover sessions with a cached report, and
  `reports.analyzed_sessions` tells clients how much coverage they have.
- **Voice usage is durable and call-specific.** The API reserves one active call per user and returns `call_id`; retries for the same active session reuse its reservation. Worker checkpoints carry a sequence and cumulative seconds, so retries do not debit twice. The API splits duration at midnight UTC and serializes reservations and debits with a per-user database lock. Browser hang-up terminates the room but supplies no duration. Internal `voice/end` merges analysis without debiting again. Audio is not persisted. See [VOICE_MODE.md](../VOICE_MODE.md) for cutoff and reconnect behavior.

---

## 📜 License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## 👤 Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
