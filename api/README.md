# 🔌 CareerSIM API

Fastify + Drizzle + TypeScript API gateway in front of the Python `agent/`
service. The API owns all persistence (Postgres); the agent stays fully
stateless and is called fresh with the caller-owned `state_snapshot` on every
turn.

## 🧱 Stack

- **Runtime**: Node 20+, TypeScript (strict ESM), pnpm
- **HTTP**: Fastify 5 + `fastify-type-provider-zod` (Zod schemas double as OpenAPI)
- **DB**: PostgreSQL 17, Drizzle ORM + drizzle-kit migrations
- **Auth**: JWT bearer (`@fastify/jwt`) + argon2id password/OTP hashing.
  Email-verified registration (6-digit code), passwordless magic-link login,
  password reset, and authenticated email/password change flows
- **Email**: `nodemailer` with a dev-friendly stdout transport when SMTP is
  unconfigured (verification codes + magic links get logged to the Fastify
  logger instead of sent)
- **CAPTCHA**: [ALTCHA](https://altcha.org) proof-of-work via `altcha-lib`.
  Server issues signed challenges at `GET /auth/challenge`; public-facing
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

Interactive OpenAPI docs are exposed at `http://localhost:8000/docs`.

## 🛣️ Endpoints (v0)

| Method | Path | Auth | CAPTCHA | Rate limit | Purpose |
| --- | --- | --- | --- | --- | --- |
| GET  | `/health` | public | — | 200/min per IP (global) | Liveness + db/agent ping |
| GET  | `/auth/challenge` | public | — | 60/min per IP | Issue an ALTCHA proof-of-work challenge for the forms below |
| POST | `/auth/register` | public | ✓ | 10/15min per IP | Start registration (password or passwordless); emails a 6-digit verification code. `202 { pending, email }` |
| POST | `/auth/resend-verification` | public | — | 3/hour per email | Re-send the registration verification code. Not captcha-gated: the pending record it resends against can only be created by `/auth/register`, which *is* gated |
| POST | `/auth/verify-email` | public | — | 10/5min per email+IP | Consume the 6-digit code; returns `{ user, token }` |
| POST | `/auth/login` | public | ✓ | 10/min per IP | Exchange credentials for a JWT |
| POST | `/auth/login/email-link` | public | ✓ | 5/hour per email | Email a magic sign-in link (passwordless) |
| POST | `/auth/magic-link/consume` | public | — | 10/5min per IP | Consume a magic-link token; returns `{ user, token }` |
| POST | `/auth/forgot-password` | public | ✓ | 3/hour per email | Email a password-reset link |
| POST | `/auth/reset-password` | public | — | 10/5min per IP | Consume a reset token + set a new password |
| GET  | `/auth/me` | jwt | — | 200/min per IP (global) | Current user |
| PATCH | `/auth/me/password` | jwt | — | 10/hour per user | Rotate / set a password (current password required when one exists) |
| POST | `/auth/me/email-change` | jwt | — | 5/hour per user | Start an email change; emails a 6-digit code to the new address |
| POST | `/auth/me/email-change/confirm` | jwt | — | 10/5min per user | Consume the code + swap the email |
| GET  | `/simulations` | jwt | — | 200/min per IP (global) | Passthrough to agent `GET /simulations` |
| POST | `/sessions` | jwt | — | 2 / 6 hours per user (env) | Create session → `POST /conversation/init` → persist |
| GET  | `/sessions` | jwt | — | 200/min per IP (global) | List caller's sessions with message counts |
| GET  | `/sessions/:id` | jwt (owner) | — | 200/min per IP (global) | Persisted messages + latest analysis/goal progress |
| POST | `/sessions/:id/messages` | jwt (owner) | — | 60/min per user | `POST /conversation/turn` → persist delta |
| POST | `/sessions/:id/messages/stream` | jwt (owner) | — | 60/min per user | SSE proxy of `POST /conversation/turn/stream`; persists on `done` |
| POST | `/sessions/:id/proactive` | jwt (owner) | — | 30/min per user | Batch followup (`trigger_type: "followup"` only) |
| POST | `/sessions/:id/proactive/stream` | jwt (owner) | — | 30/min per user | SSE followup (`trigger_type: "followup"` only) |
| POST | `/sessions/:id/nudge` | jwt (owner) | — | 120/min per user | Guarded inactivity nudge (batch only) |
| POST | `/sessions/:id/voice/start` | jwt (owner) | — | 10/min per user | Mint a LiveKit join token. `503 voice_disabled`, `429 voice_quota_exhausted`, `409 voice_call_in_progress` |
| POST | `/sessions/:id/voice/end` | jwt (owner) | — | 20/min per user | Mark the call ended (clears the active-call guard). Quota debit is worker-authoritative, not here |

### Internal voice routes (worker ⇄ API)

These three are part of the `agent-voice` worker trust boundary, **not** the
public surface. They authenticate via `X-Internal-Key` (the shared
`AGENT_INTERNAL_KEY`), are hidden from the OpenAPI docs, keyed per-session for
rate limiting (30/min), and honour the `VOICE_ENABLED` kill switch before the
key check so the worker gets a clear `503` to stop polling on.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET  | `/internal/sessions/:id/state-for-voice` | `X-Internal-Key` | Freshest wire-format `state_snapshot` for a room join |
| GET  | `/internal/sessions/:id/voice-budget` | `X-Internal-Key` | Remaining daily voice seconds for the session owner (arms the worker's cutoff watchdog) |
| POST | `/internal/sessions/:id/voice/end` | `X-Internal-Key` | **Authoritative** call-end: debits `voice_minute_usage` by the worker-measured seconds and merges aggregate voice analytics into `state_snapshot.analysis.voice` |

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

## 📁 Layout

```text
api/
├── src/
│   ├── index.ts                # Server entry (listen + graceful shutdown)
│   ├── server.ts               # buildApp({ db, agent, jwtSecret }) — exported for tests
│   ├── config/env.ts           # Zod-validated env
│   ├── db/
│   │   ├── client.ts           # createPgClient / createPgliteClient
│   │   ├── schema.ts           # users, authTokens, sessions (+ voice_call_* cols), messages, voiceMinuteUsage
│   │   ├── migrate.ts          # drizzle-orm migrator (node-postgres)
│   │   └── migrations/         # drizzle-kit output (0002 email verification + authTokens; 0003 voice mode)
│   ├── agent/
│   │   ├── types.ts            # Wire types mirroring agent/src/careersim_agent/api/app.py
│   │   └── client.ts           # HttpAgentClient + parseAgentSSE
│   ├── plugins/
│   │   ├── auth.ts             # @fastify/jwt + app.authenticate decorator
│   │   ├── altcha.ts           # ALTCHA: GET /auth/challenge + app.altcha.verify(payload)
│   │   ├── rate-limit.ts       # @fastify/rate-limit: Redis/LRU store, keyers (IP/email/user), policy catalogue
│   │   ├── mailer.ts           # nodemailer + dev stdout fallback (app.mailer.send)
│   │   └── errors.ts           # HttpError + Zod validation mapping
│   └── modules/
│       ├── auth/               # register, verify, login, magic-link, forgot/reset, profile (change pw/email)
│       ├── health/             # /health with db + agent probes
│       ├── simulations/        # agent passthrough
│       ├── sessions/           # create, list, get, turn (batch + SSE), proactive
│       └── voice/              # voice.route.ts (start/end + internal), voice.service.ts (LiveKit token + quota), voice.schema.ts
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

`pnpm e2e` runs an interactive CLI that exercises the full journey against a
real stack (API + agent + Postgres, e.g. `docker compose -f
docker-compose.local.yml up`): `/health` → `/auth/register` → `/auth/me` →
`/simulations` → `/sessions` → live chat on the selected simulation.

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
`burstiness` ranges taken straight from `GET /sessions/:id`'s
`session_config`. A background auto-nudger polls `/nudge` every
`AUTO_NUDGE_SECONDS` (default `5`, set `0` to disable); the server, not
the script, decides when to actually fire based on the persona's
`inactivityNudgeDelaySec` window — so you observe the same behaviour as
the Gradio dev UI.

Tests cover:

- Health probe (happy + degraded agent paths)
- Auth (register + login): password + passwordless registration, 6-digit
  verification, resend, wrong/expired code, duplicate email, wrong
  password, tampered token, email normalisation, `/auth/me`, change
  password, request + confirm email change
- Auth (passwordless): magic-link issuance, consumption, token
  single-use + expiry, forgot-password → reset-password round-trip
- ALTCHA: `/auth/challenge` response shape, bypass mode accepting the
  test token and rejecting garbage, production mode rejecting missing /
  bogus / tampered payloads, and a real PoW solve against a live
  challenge that round-trips through `/auth/register`
- Rate limiting: disabled flag is a hard no-op, global default fires a
  `RATE_LIMITED` envelope with `retry-after` once the quota burns,
  per-email bucket isolation on `/auth/resend-verification`, per-user
  bucket isolation on `/auth/me/password`, per-IP burst ceiling on
  `/auth/login`
- Simulations: auth-required + passthrough
- Sessions (batch): create, get, list, ownership, unknown id, message ordering, validation
- Sessions (SSE stream): event shape, persistence on `done`, ownership
- Nudge guardrails: `no_human_activity`, `not_enough_idle`, `budget_exhausted`, counter reset on human reply, override floor honoured
- Proactive followup: batch + streaming paths, rejection of non-followup triggers
- Statelessness contract: two users do not bleed, DB as single source of truth, exactly one agent call per turn, deterministic replay across sessions
- Voice: token mint shape + ownership/404, `503 voice_disabled` kill switch on both public and internal routes, `429 voice_quota_exhausted` at the daily cap, `409 voice_call_in_progress` concurrency guard, internal-key enforcement, and the worker-authoritative `voice/end` debit + analytics merge

The agent contract is faked deterministically in `tests/helpers/fake-agent.ts` in the same style as `_FakeGraph` at `agent/tests/test_api.py:155`, so running the suite requires neither the Python agent nor an OpenAI key.

## 📣 Proactive triggers

The agent supports three proactive graph branches. The API maps them to three
distinct endpoints with different semantics:

| Trigger | API surface | Why |
| --- | --- | --- |
| `start` | Runs once inside `POST /sessions` (server-side during init). | Opening lines should never be requested again from a client. |
| `followup` | `POST /sessions/:id/proactive` (batch) or `POST /sessions/:id/proactive/stream` (SSE). | The AI is choosing to continue speaking right after its own last message — we stream it so the frontend can replay each line with its `typing_delay_sec`. |
| `inactivity` | `POST /sessions/:id/nudge` (batch only, guardrailed). | A timer fired while we're waiting for the human — the result is a single short message, there's no reason to stream it, and unbounded retries would spam the agent. |

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
| `DATABASE_URL` | — | Postgres connection string |
| `AGENT_API_URL` | — | Base URL of the agent FastAPI server (`agent/ --serve api`) |
| `AGENT_INTERNAL_KEY` | — | Shared secret sent as `X-Internal-Key` on every API ⇒ agent call. Must match the agent's `AGENT_INTERNAL_KEY`. Leave empty for single-service dev (agent accepts unauthenticated calls with a warning); set to a long random string in production |
| `JWT_SECRET` | — | Min 16 chars; rotate via deploy |
| `JWT_EXPIRES_IN` | `7d` | Passed to `@fastify/jwt` |
| `WEB_APP_URL` | `http://localhost:3000` | Public origin of the Next.js app. Embedded in outbound emails (magic links, password reset) |
| `CORS_ALLOWED_ORIGINS` | — | Optional comma-separated browser origins allowed to call the API. Leave empty to keep CORS wide open |
| `ALTCHA_HMAC_KEY` | — | Server-only secret (≥16 chars) used to sign + verify ALTCHA challenges. Rotating invalidates in-flight challenges |
| `ALTCHA_MAX_NUMBER` | `50000` | Upper bound for the PoW target. Raise under attack; lower for low-power clients |
| `RATE_LIMIT_ENABLED` | `true` | Master on/off switch for `@fastify/rate-limit`. Flip to `false` in an incident / load test |
| `REDIS_URL` | — | Optional Redis connection string (e.g. `redis://localhost:6379`). When set, rate-limit buckets are shared across API instances; otherwise the plugin uses a per-process LRU store |
| `SESSIONS_CREATE_MAX` | `2` | Per-user cap on `POST /sessions` within `SESSIONS_CREATE_WINDOW`. Each new session spins up an agent thread + burns LLM tokens, so this is kept aggressive by default |
| `SESSIONS_CREATE_WINDOW` | `6 hours` | Window for `SESSIONS_CREATE_MAX`. Accepts any duration `@fastify/rate-limit` understands (`'30 minutes'`, `'1 hour'`, `'6 hours'`, or a raw ms number) |
| `HOST` | `0.0.0.0` | Fastify bind host |
| `PORT` | `8000` | Fastify bind port |
| `LOG_LEVEL` | `info` | pino level |

Voice mode (the `/voice/*` surface — mirrors `VOICE_ENABLED` on the agent;
flip both together). Routes always register so the kill switch works without
a redeploy:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOICE_ENABLED` | `true` | When `false`, every `/voice/*` route returns `503 voice_disabled` and the web Call button is hidden |
| `VOICE_DAILY_MINUTES_PER_USER` | `60` | True per-user-per-day ceiling enforced via `voice_minute_usage`; debited authoritatively by the worker, which hard-disconnects a call once the budget is spent |
| `VOICE_ACTIVE_CALL_STALE_SECONDS` | `4200` | Single-active-call guard window. An un-ended call row older than this is treated as a crashed worker (so the user isn't locked out); `0` disables the guard |
| `LIVEKIT_URL` | — | SFU URL the API mints tokens against. Must match the `livekit` + `agent` services |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | — | LiveKit credentials used to sign short-lived join tokens (TTL defaults to `cap + 10 min`) |

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
- **Streaming persists exactly once.** The SSE proxy forwards every
  `event: message` 1:1 to the client, then persists the delta + snapshot when
  the upstream `event: done` arrives. A client that disconnects mid-stream
  aborts the upstream request via `AbortController`.
- **Ownership is checked in the service layer.** Routes only destructure
  `request.user.sub`; the service throws `forbidden()` if the session's
  `user_id` doesn't match, which the error plugin maps to HTTP 403.
- **Auth secrets at rest are argon2id-hashed.** Passwords, 6-digit
  verification codes, and magic-link tokens all go through the same
  argon2id config before being written to `auth_tokens` / `users`. The
  raw values only ever exist in memory long enough to be emailed and are
  never logged. Magic-link / reset tokens are single-use (`consumed_at`
  flipped atomically) and expire on the server.
- **ALTCHA is our only bot-defence layer.** The widget solves a signed
  proof-of-work challenge client-side; the server re-verifies the HMAC
  and the solution with the shared `ALTCHA_HMAC_KEY`. There is no
  third-party CAPTCHA and no IP reputation service — rate-tuning is a
  matter of bumping `ALTCHA_MAX_NUMBER`. Tests set `altcha.bypass = true`
  at app build time so the existing suites don't need to solve a PoW on
  every request; a dedicated `altcha.test.ts` suite turns bypass off to
  cover the production path end-to-end.
- **Rate limiting complements ALTCHA, it does not replace it.** ALTCHA
  adds per-request cost (a few ms of client CPU); rate limiting caps
  sustained request counts. The plugin runs in `preHandler` rather than
  `onRequest` so body-keyed limits (e.g. the 3/hour quota per email
  mailbox on `/auth/forgot-password`) can actually read the parsed
  body. All 429 responses are routed through the same `HttpError`
  pipeline as the rest of the API so the envelope `{ error, message,
  retryAfter }` is uniform. Buckets live in Redis when `REDIS_URL` is
  set and in an in-memory LRU otherwise — swapping stores doesn't
  change behaviour, only the sharing radius.
- **Dev email goes to stdout.** When `SMTP_HOST` is empty the mailer
  plugin falls back to a logger transport that prints the full rendered
  email, so registration / reset flows are usable locally without SMTP
  credentials.
- **Voice quota is worker-authoritative.** The API only mints a
  short-lived LiveKit token and enforces ownership + a start-time gate;
  the user-facing `POST /voice/end` deliberately does **not** debit the
  quota. The `agent-voice` worker measures call duration on a server-side
  clock the browser can't influence and reports it via the internal
  `POST /internal/sessions/:id/voice/end`, which is the single source of
  truth for the `voice_minute_usage` debit and the
  `state_snapshot.analysis.voice` merge. A single-active-call guard
  (`VOICE_ACTIVE_CALL_STALE_SECONDS`) stops a user opening N tabs to run N
  concurrent calls past the daily cap. Audio is never persisted — only the
  transcribed turns (through the existing chat-message path) and aggregate
  voice analytics. See [VOICE_MODE.md](../VOICE_MODE.md) for the full
  budget-enforcement design.

---

## 📜 License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## 👤 Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
