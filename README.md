# CareerSIM — AI-Powered Career Skills Simulator

**CareerSIM** is a direct-to-consumer (B2C) web application that helps individuals master critical career skills through hyper-realistic, AI-powered simulations. Users practice challenging professional situations — from behavioral interviews to difficult conversations — in a safe, repeatable environment and receive immediate, data-driven feedback to accelerate their personal and professional growth.

The platform empowers users to build confidence and competence for career-defining moments. By leveraging a LangGraph-based generative AI engine, CareerSIM provides dynamic, conversational practice with a diverse cast of AI personas, moving beyond rote memorization to foster genuine skill development.

<img src="./landing/public/figma/hero.png" alt="CareerSIM landing page hero section" width="960" />

> [!NOTE]
> **Repository is mid-migration.** The active runtime is `api/` + `web/` + `agent/` + `postgres` + `redis`, with a standalone static marketing site in `landing/`. Four earlier services (`backend/`, `frontend/`, `rag/`, `transformers/`) are still in the tree **for reference only** and are flagged as deprecated in both their own READMEs and `docker-compose.local.yml`. Do not build new features against them.

## Architecture

CareerSIM runs as three first-party services plus shared infrastructure. The API owns all persistence; the agent is a pure function of its inputs (full state snapshot in, new messages + updated state out) — this makes replay, testing, and horizontal scaling straightforward.

```
                      ┌──────────────────────┐
                      │   Web (Next.js 16)   │
                      │   App Router + RSC   │
                      │   :3000              │
                      └──────────┬───────────┘
                                 │  REST + SSE (JWT Bearer)
                      ┌──────────▼───────────┐
                      │  API (Fastify 5 +    │
                      │  Drizzle + Zod)      │
                      │  :8000               │
                      └───┬──────────────┬───┘
                          │              │
             POST /conv/* │              │ SQL
            (batch + SSE) │              │
                      ┌───▼──────┐   ┌───▼──────────┐
                      │  Agent   │   │ PostgreSQL 17│
                      │ FastAPI +│   │ + Redis 7    │
                      │ LangGraph│   │ :5432 / :6379│
                      │  :8001   │   └──────────────┘
                      │          │
                      │  embedded│
                      │  Chroma  │
                      └──────────┘
```


| Service      | Stack                                                                    | Description                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **landing**  | Astro 6 static site, TypeScript, plain CSS                               | Public `careersim.local` marketing page generated from the Figma landing design. Includes a manual Figma sync script for reference screenshots and node metadata.                                      |
| **web**      | Next.js 16 (App Router, React 19), TypeScript 6, Tailwind 3              | Client-rendered SPA over the API: auth, simulation picker, session chat with SSE streaming, nudge auto-polling, follow-up bursts.                                                                   |
| **api**      | Node.js 22, Fastify 5, Drizzle ORM, PostgreSQL, `@fastify/jwt`, argon2id, Zod 4 | Owns auth, persistence, and all session state. Proxies agent calls (including SSE) and enforces per-session ownership, nudge cadence, and proactive-trigger policy.                                 |
| **agent**    | Python 3.11+, FastAPI, LangGraph, Chroma (embedded), OpenAI / OpenRouter | Stateless conversation engine. One binary serves either a Gradio dev console or a FastAPI production server (`--serve api`). Retrieval uses an embedded Chroma store — **no separate RAG service**. |
| **postgres** | PostgreSQL 17                                                            | Source of truth for users, sessions, messages, and state snapshots.                                                                                                                                 |
| **redis**    | Redis 7                                                                  | Present in compose for future rate-limiting / pub-sub work.                                                                                                                                         |


### Deprecated services (kept for reference)


| Legacy directory                                                       | Replaced by | Notes                                                                                                   |
| ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `backend/` (Express + TypeORM + Socket.IO + Stripe)                    | `api/`      | REST surface, JWT, and SSE streaming fully rewritten on Fastify.                                        |
| `frontend/` (Vite + React 18 SPA)                                      | `web/`      | Retro theme ported 1:1; admin panel / analytics dashboards dropped — the new API doesn't back them yet. |
| `transformers/` (FastAPI + HuggingFace sentiment / emotion / toxicity) | `agent/`    | Evaluation now happens in-process via an LLM eval model (`OPENAI_EVAL_MODEL`).                          |
| `rag/` (FastAPI + ChromaDB service)                                    | `agent/`    | Chroma is embedded directly in the agent; no HTTP boundary.                                             |


Each of those directories carries a `> [!WARNING] DEPRECATED` banner at the top of its README. They are also commented out in `docker-compose.local.yml` under a deprecation block and will be removed in a future clean-up pass.

## Project Structure

```text
careersim/
├── landing/                    # Astro static landing page + Figma design sync
│   ├── src/{pages,styles}
│   ├── figma/                  # source design metadata and sync summary
│   └── scripts/sync-figma.mjs
├── api/                        # Fastify + Drizzle API (active)
│   ├── src/{agent,config,db,modules,plugins}
│   ├── tests/                  # Vitest + pglite + FakeAgent
│   └── drizzle.config.ts
├── web/                        # Next.js 16 App Router frontend (active)
│   └── src/{app,components,contexts,lib}
├── agent/                      # Python LangGraph agent (active)
│   ├── src/careersim_agent/
│   ├── data/{personas.json,simulations.json,documents/}
│   └── tests/
├── backend/                    # DEPRECATED — superseded by api/
├── frontend/                   # DEPRECATED — superseded by web/
├── rag/                        # DEPRECATED — absorbed into agent/
├── transformers/               # DEPRECATED — absorbed into agent/
├── infrastructure/             # Targets legacy stack; needs a pass for api/web/agent
│   ├── aws/                    # Terraform: ECS/Fargate, RDS, ElastiCache, ALB
│   ├── aws-transformers/       # Standalone Transformers deployment
│   └── k8s/                    # Kustomize (dev + prod overlays)
├── docker-compose.local.yml    # Local dev stack (api + web + agent + postgres + redis)
├── PERSONAS.md                 # AI persona definitions
├── LICENSE.md                  # MIT
└── README.md                   # (this file)
```

## Quick Start

### Prerequisites

- **Docker** + **Docker Compose** (for the one-shot path)
- **Node.js ≥ 22.12** for `api/`; **Node.js ≥ 20** for `landing/` and `web/`; **pnpm ≥ 10**
- **Python ≥ 3.11** + `[uv](https://docs.astral.sh/uv/)` (for running `agent/` outside Docker)
- An **OpenAI-compatible API key** (OpenAI, OpenRouter, …) for the agent

### Local development with Docker Compose

```bash
# 1. Configure each service's .env (all three are required)
cp agent/.env.example agent/.env   # set OPENAI_API_KEY + model names
cp api/.env.example   api/.env     # set JWT_SECRET (min 16 chars)
cp web/.env.example   web/.env     # usually OK as-is; NEXT_PUBLIC_API_URL=http://localhost:8000

# 2. Bring the whole stack up (builds on first run, hot-reloads after)
docker compose -f docker-compose.local.yml up --build
```

This starts:


| URL                                                      | Service                                         |
| -------------------------------------------------------- | ----------------------------------------------- |
| [http://localhost:3000](http://localhost:3000)           | `web` — Next.js app                             |
| [http://localhost:8000](http://localhost:8000)           | `api` — Fastify API                             |
| [http://localhost:8000/docs](http://localhost:8000/docs) | API Swagger UI (zod schemas → OpenAPI)          |
| [http://localhost:8001](http://localhost:8001)           | `agent` — FastAPI (stateless)                   |
| [http://localhost:8001/docs](http://localhost:8001/docs) | Agent Swagger UI                                |
| localhost:5432                                           | PostgreSQL (`careersim` / `careersim_password`) |
| localhost:6379                                           | Redis                                           |


The `api` container runs Drizzle migrations on start; no manual seeding needed. Register a new user from the web UI (there is **no default admin account** — that concept belonged to the legacy `backend/`).

### Running a service outside Docker

Useful when you want a faster hot-reload loop for a single service. Each subdirectory has its own README with detailed flags.

```bash
# Landing
cd landing && pnpm install && pnpm dev                       # :4321

# API
cd api && pnpm install && pnpm db:migrate && pnpm dev        # :8000

# Web
cd web && pnpm install && pnpm dev                           # :3000

# Agent (FastAPI production server)
cd agent && uv sync && uv run python -m careersim_agent.main --serve api --port 8001

# Agent (Gradio dev console — stateful, good for prompt iteration)
cd agent && uv run python -m careersim_agent.main            # :7860
```

When mixing Docker + host, point each service at the others via `host.docker.internal` / `localhost` as appropriate — see `docker-compose.local.yml` for the canonical wiring.

## Core Features

### Simulation library

Nine first-party simulations shipped in `agent/data/simulations.json`, each bound to a persona with its own hidden goals, difficulty, and success criteria. The web app lists them at `/simulations`.

### Live chat with SSE streaming

The `api` exposes `POST /sessions/:id/messages/stream`, which proxies the agent's SSE stream end-to-end. The web client shows an optimistic echo of the user's message, renders a typing indicator until the first AI chunk lands, then streams the reply token-by-token. Persistence happens exactly once when the upstream emits `done`.

### LangGraph conversation engine

Stateful graph inside `agent/`:

- Processes user input, fetches embedded-Chroma context, generates a persona response, and runs an LLM-based eval pass (sentiment / emotion / per-goal progress).
- Proactive messages are explicit graph branches: `start` (conversation opener, fired during session init), `followup` (multi-message burst, capped by `burstiness.max`), and `inactivity` (guardrailed nudge).
- Fully stateless at the API boundary — the caller-owned `state_snapshot` is sent on every turn, mirroring the `TestStatelessness` suite in `agent/tests/test_api.py`.

### Inactivity nudges (pull model)

The `api` exposes `POST /sessions/:id/nudge`; the server decides idempotently whether to fire based on the persona's `inactivityNudgeDelaySec` window and `inactivityNudges.max` budget. The web client polls every 5 s while idle and stops automatically when the server returns `nudges_disabled` or `budget_exhausted`, re-arming on the next human reply. See `api/README.md` for the exact contract.

### Follow-up bursts

`POST /sessions/:id/proactive/stream` drives persona-initiated follow-ups capped by `burstiness.max - 1` additional messages. The web UI exposes this behind a "Follow up" button and surfaces the cap as a `{N} followups max` badge alongside typing speed and nudge count.

### Retrieval-Augmented Generation (embedded)

Per-simulation and per-persona Markdown under `agent/data/documents/` is indexed into a persisted Chroma store (volume `agent_chroma_db`). No separate HTTP hop.

### Per-turn evaluation

Sentiment and emotion for both sides of the conversation, plus per-goal progress with confidence scoring, computed by a cheaper eval model (`OPENAI_EVAL_MODEL`) on every turn. Results are persisted to the session's `analysis` + `goal_progress` columns and returned in `GET /sessions/:id`.

### Authentication

Email + password → JWT bearer (stored in `localStorage` on the web side; `Authorization: Bearer` on every request). Passwords hashed with argon2id. No refresh tokens, email verification, or Stripe billing — all of that lived in the deprecated `backend/` and has not been re-implemented.

## AI Personas

Shipped in `agent/data/personas.json`. Each declares a `conversationStyle` that the runtime surfaces in `GET /sessions/:id.session_config` and the web UI badges.


| Persona           | Role                               | Simulation slug                          | Typing (wpm) | Nudges max | Burst max |
| ----------------- | ---------------------------------- | ---------------------------------------- | ------------ | ---------- | --------- |
| **Brenda Vance**     | By-the-Book HR Manager             | `behavioral-interview-brenda`            | 110          | 2          | 3         |
| **Alex Chen**        | Passionate Tech Lead               | `tech-cultural-interview-alex`           | 140          | 3          | 3         |
| **David Miller**     | Senior Analyst / Skeptical Veteran | `pitching-idea-david`                    | 120          | 2          | 1         |
| **Sarah Jenkins**    | Overwhelmed Project Manager        | `saying-no-to-extra-work-sarah`          | 130          | 2          | 2         |
| **Michael Reyes**    | Disengaged High-Performer          | `reengaging-disengaged-employee-michael` | 100          | 1          | 1         |
| **Chloe Davis**      | Eager but Anxious Junior           | `delegating-task-chloe`                  | 135          | 2          | 2         |
| **Priya Patel**      | Senior Data Analyst                | `data-analyst-technical-interview-priya` | 125          | 3          | 2         |
| **Vikram Shah**      | Pipeline-Pressured Recruiter       | `recruiter-coldreach-vikram`             | 150          | 3          | 3         |
| **Marcus Whitfield** | Time-Boxed VP of Engineering       | `informational-chat-marcus`              | 95           | 1          | 1         |


See [PERSONAS.md](PERSONAS.md) for the full persona definitions, hidden goals, and success criteria.

## End-to-end simulation testing

`agent/test_simulation.py` is a CLI harness for running a complete simulation end-to-end against the agent's **Gradio dev console** — useful for sanity-checking a new persona, a tweaked goal, or an evaluation-threshold change without clicking through the UI turn-by-turn. Two modes: **interactive** (you type the user's side) or **`--auto`** (an OpenAI-driven candidate plays the user side using a per-simulation strategy prompt baked into the script). The full transcript and per-turn goal-progress snapshots can be written to `agent/logs/` with `--log` and exported as JSON with `--json`.

```bash
# Requires the Gradio dev console running on :7860 and OPENAI_API_KEY for --auto.
cd agent && uv run python -m careersim_agent.main &
cd agent && uv run python test_simulation.py --list
cd agent && uv run python test_simulation.py \
  --sim recruiter-coldreach-vikram --auto --log --json
```

See [agent/README.md](agent/README.md#end-to-end-simulation-runs-test_simulationpy) for the full flag table and the convention for adding `SIMULATION_PROMPTS` entries when introducing a new simulation.

## Tech Stack


| Layer          | Technology                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing        | Astro 6 static output, TypeScript 5.9, plain CSS, Figma reference sync                                                                            |
| Web            | Next.js 16 (App Router, Turbopack), React 19, TypeScript 6, Tailwind CSS 3, `eventsource-parser`                                                  |
| API            | Node.js 22.12+, Fastify 5, TypeScript 6 (strict ESM), Drizzle ORM + drizzle-kit, `@fastify/jwt`, argon2id, Zod 4 + `fastify-type-provider-zod`, `undici` |
| Agent          | Python 3.11+, FastAPI, LangGraph, Chroma (embedded), OpenAI SDK, Gradio 5, `uv`                                                                   |
| Data           | PostgreSQL 17, Redis 7                                                                                                                            |
| LLM / models   | OpenAI-compatible chat + embeddings (OpenAI, OpenRouter, …); in-process LLM eval                                                                  |
| Testing        | Vitest 4 + `@electric-sql/pglite` + `FakeAgent` (api), `pytest` + `_FakeGraph` (agent)                                                            |
| Infrastructure | Docker, Docker Compose; Terraform (AWS) and Kustomize (K8s) checked in but targeting the legacy layout                                            |


## Infrastructure

### AWS (Terraform) — `infrastructure/aws/`

Production-ready ECS Fargate topology with VPC, ALB, RDS PostgreSQL, ElastiCache Redis, EFS, Cloud Map service discovery, and optional GPU instances for the deprecated `transformers` service. Currently wired for the **legacy** `backend` + `frontend` + `transformers` + `rag` stack and has **not** been updated for `api` + `web` + `agent`.

### Kubernetes (Kustomize) — `infrastructure/k8s/`

Self-hosted deployment with dev and prod overlays, StatefulSets for databases, and GPU scheduling. Same caveat as above — it targets the legacy layout.

> [!IMPORTANT]
> Both infrastructure trees need a pass before a production deploy of the new stack. The local `docker-compose.local.yml` is the canonical topology in the meantime.

## Development Loops

```bash
# From the repo root
docker compose -f docker-compose.local.yml up --build         # full stack
docker compose -f docker-compose.local.yml logs -f api web    # tail two services
docker compose -f docker-compose.local.yml restart api        # after a .env change

# Landing
cd landing && pnpm check && pnpm build
cd landing && pnpm sync:figma  # requires FIGMA_TOKEN in the shell

# API
cd api && pnpm test          # vitest (pglite + FakeAgent — no OpenAI, no network)
cd api && pnpm e2e           # interactive CLI against a live stack
cd api && pnpm typecheck

# Web
cd web && pnpm lint && pnpm typecheck

# Agent — unit / contract tests (mocked LangGraph, no OpenAI key needed)
cd agent && uv run pytest

# Agent — end-to-end simulation runs against a live Gradio dev console.
# Useful for sanity-checking new personas, goals, or eval thresholds.
# Requires the dev console running (`uv run python -m careersim_agent.main`)
# and OPENAI_API_KEY for --auto. See agent/README.md for the full flag list.
cd agent && uv run python test_simulation.py --list
cd agent && uv run python test_simulation.py \
  --sim recruiter-coldreach-vikram --auto --log --json
```

## Roadmap

- **Port infrastructure to the new stack** — Terraform + Kustomize for `api` / `web` / `agent`.
- **Remove the deprecated directories** once the migration is considered complete and nothing still references them.
- **Voice / phone-call practice with AI personas** — real-time spoken simulations for the moments where text doesn't cut it (recruiter screens, salary calls, informational interviews, difficult 1:1s). Targeted scope:
  - **Browser-native voice mode** in `web/` using WebRTC mic capture, low-latency STT (e.g., Whisper / Deepgram streaming), and TTS playback (e.g., ElevenLabs / OpenAI tts) — no install required.
  - **Real phone calls** for higher-stakes practice — outbound (the persona calls the user at a scheduled time) and inbound (the user dials a number and gets connected to the persona) via Twilio Voice or LiveKit, with the same LangGraph engine driving the conversation.
  - **Per-persona voice + speech style** — extends `conversationStyle` in `agent/data/personas.json` with voice ID, speaking pace (wpm), filler-word frequency, accent, and barge-in tolerance so Vikram sounds rapid-fire and salesy while Marcus is dry, slow, and tolerant of silence.
  - **Voice-aware evaluation** — the existing per-turn eval is extended to score **spoken-only signals**: pacing, filler words ("um", "like"), interruptions, time-to-respond, vocal confidence, and silence handling — surfaced in the post-session feedback alongside the text-based goal scores.
  - **Realistic interruption mechanics** — wire the agent's existing `burstiness` / `inactivityNudges` config to voice-side barge-in so a recruiter can talk over you mid-answer and a senior stranger can let a 6-second silence sit.
- **Community features** — public leaderboards and discussion forums.
- **Certification paths** — structured learning programs with shareable certificates.
- **AI persona builder** — user-created custom personas for specialized practice.
- **Team / B2B version** — enterprise offering with team analytics and management.

---

## License

This project is licensed under the MIT License — see the [LICENSE.md](LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))