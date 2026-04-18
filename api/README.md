# CareerSim API

Fastify + Drizzle + TypeScript API gateway in front of the Python `agent/`
service. The API owns all persistence (Postgres); the agent stays fully
stateless and is called fresh with the caller-owned `state_snapshot` on every
turn.

## Stack

- **Runtime**: Node 20+, TypeScript (strict ESM), pnpm
- **HTTP**: Fastify 5 + `fastify-type-provider-zod` (Zod schemas double as OpenAPI)
- **DB**: PostgreSQL 17, Drizzle ORM + drizzle-kit migrations
- **Auth**: JWT bearer (`@fastify/jwt`) + argon2id password hashing
- **Upstream client**: `undici` + `eventsource-parser` for SSE proxying
- **Tests**: Vitest + Fastify `app.inject()` + `@electric-sql/pglite` + an in-process `FakeAgent`

## Quick start

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

## Endpoints (v0)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET  | `/health` | public | Liveness + db/agent ping |
| POST | `/auth/register` | public | Create user, return JWT |
| POST | `/auth/login` | public | Exchange credentials for JWT |
| GET  | `/auth/me` | jwt | Current user |
| GET  | `/simulations` | jwt | Passthrough to agent `GET /simulations` |
| POST | `/sessions` | jwt | Create session → `POST /conversation/init` → persist |
| GET  | `/sessions` | jwt | List caller's sessions with message counts |
| GET  | `/sessions/:id` | jwt (owner) | Persisted messages + latest analysis/goal progress |
| POST | `/sessions/:id/messages` | jwt (owner) | `POST /conversation/turn` → persist delta |
| POST | `/sessions/:id/messages/stream` | jwt (owner) | SSE proxy of `POST /conversation/turn/stream`; persists on `done` |
| POST | `/sessions/:id/proactive` | jwt (owner) | Batch followup (`trigger_type: "followup"` only) |
| POST | `/sessions/:id/proactive/stream` | jwt (owner) | SSE followup (`trigger_type: "followup"` only) |
| POST | `/sessions/:id/nudge` | jwt (owner) | Guarded inactivity nudge (batch only) |

## Layout

```text
api/
├── src/
│   ├── index.ts                # Server entry (listen + graceful shutdown)
│   ├── server.ts               # buildApp({ db, agent, jwtSecret }) — exported for tests
│   ├── config/env.ts           # Zod-validated env
│   ├── db/
│   │   ├── client.ts           # createPgClient / createPgliteClient
│   │   ├── schema.ts           # users, sessions, messages
│   │   ├── migrate.ts          # drizzle-orm migrator (node-postgres)
│   │   └── migrations/         # drizzle-kit output
│   ├── agent/
│   │   ├── types.ts            # Wire types mirroring agent/src/careersim_agent/api/app.py
│   │   └── client.ts           # HttpAgentClient + parseAgentSSE
│   ├── plugins/
│   │   ├── auth.ts             # @fastify/jwt + app.authenticate decorator
│   │   └── errors.ts           # HttpError + Zod validation mapping
│   └── modules/
│       ├── auth/               # register / login / me
│       ├── health/             # /health with db + agent probes
│       ├── simulations/        # agent passthrough
│       └── sessions/           # create, list, get, turn (batch + SSE), proactive
├── tests/
│   ├── helpers/
│   │   ├── build-test-app.ts   # pglite + FakeAgent wiring
│   │   └── fake-agent.ts       # mirrors agent/tests/test_api.py _FakeGraph contract
│   ├── health.test.ts
│   ├── auth.test.ts
│   ├── simulations.test.ts
│   ├── sessions.batch.test.ts
│   ├── sessions.stream.test.ts
│   └── sessions.statelessness.test.ts
├── Dockerfile
├── drizzle.config.ts
├── vitest.config.ts
└── tsconfig.json
```

## Testing

```bash
pnpm test            # vitest run (pglite + FakeAgent, no network, no OpenAI)
pnpm test:watch
pnpm typecheck
```

### Interactive end-to-end flow

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
- Auth: register / login / `/me`, duplicate email, wrong password, tampered token, email normalisation
- Simulations: auth-required + passthrough
- Sessions (batch): create, get, list, ownership, unknown id, message ordering, validation
- Sessions (SSE stream): event shape, persistence on `done`, ownership
- Nudge guardrails: `no_human_activity`, `not_enough_idle`, `budget_exhausted`, counter reset on human reply, override floor honoured
- Proactive followup: batch + streaming paths, rejection of non-followup triggers
- Statelessness contract: two users do not bleed, DB as single source of truth, exactly one agent call per turn, deterministic replay across sessions

The agent contract is faked deterministically in `tests/helpers/fake-agent.ts` in the same style as `_FakeGraph` at `agent/tests/test_api.py:155`, so running the suite requires neither the Python agent nor an OpenAI key.

## Proactive triggers

The agent supports three proactive graph branches. The API maps them to three
distinct endpoints with different semantics:

| Trigger | API surface | Why |
| --- | --- | --- |
| `start` | Runs once inside `POST /sessions` (server-side during init). | Opening lines should never be requested again from a client. |
| `followup` | `POST /sessions/:id/proactive` (batch) or `POST /sessions/:id/proactive/stream` (SSE). | The AI is choosing to continue speaking right after its own last message — we stream it so the frontend can replay each line with its `typing_delay_sec`. |
| `inactivity` | `POST /sessions/:id/nudge` (batch only, guardrailed). | A timer fired while we're waiting for the human — the result is a single short message, there's no reason to stream it, and unbounded retries would spam the agent. |

### Inactivity nudge contract

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

## Environment

See `.env.example` for the authoritative list. Required in production:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | Postgres connection string |
| `AGENT_API_URL` | — | Base URL of the agent FastAPI server (`agent/ --serve api`) |
| `JWT_SECRET` | — | Min 16 chars; rotate via deploy |
| `JWT_EXPIRES_IN` | `7d` | Passed to `@fastify/jwt` |
| `HOST` | `0.0.0.0` | Fastify bind host |
| `PORT` | `8000` | Fastify bind port |
| `LOG_LEVEL` | `info` | pino level |

## Docker

```bash
docker build -t careersim-api ./api
docker run --rm -p 8000:8000 --env-file api/.env careersim-api
```

The top-level `docker-compose.local.yml` wires `api` + `postgres` + `redis`
together. Point `AGENT_API_URL` at the host-side agent (run with
`python -m careersim_agent.main --serve api --port 8001`) until the agent
service is uncommented in compose.

## Design notes

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
