# CareerSim Web

Next.js 15 (App Router) frontend for the CareerSim platform. Talks directly to
the Fastify `api/` service — auth, simulations, personas, sessions, and the SSE
streaming surface. No admin panel, no socket.io, no analytics: those belong to
the legacy `frontend/` app and are not backed by the new API.

## Stack

- **Runtime**: Node 20+, pnpm
- **Framework**: Next.js 15 (App Router, Turbopack), React 19
- **Styling**: Tailwind 3 with the shared retro theme (fonts, shadows,
  light/dark palette ported from `frontend/`)
- **Auth**: JWT stored in `localStorage` + `Authorization: Bearer` header (no
  HTTP-only cookie / BFF layer yet)
- **Streaming**: `fetch` + `ReadableStream` + `eventsource-parser` (the native
  `EventSource` can't set bearer headers, and the API is POST-based)

## Quick start

```bash
cd web
pnpm install
cp .env.example .env          # set NEXT_PUBLIC_API_URL if needed

# Dev server on :3000 (expects the api/ service on :8000)
pnpm dev
```

Open http://localhost:3000 — you'll land on `/dashboard`, which redirects to
`/login` until you register or sign in.

## Pages

| Path | Purpose |
| --- | --- |
| `/login`, `/register` | Email + password auth (`POST /auth/login`, `POST /auth/register`) |
| `/dashboard` | Welcome + counts + recent sessions |
| `/simulations` | List simulations from `GET /simulations` |
| `/simulations/[slug]` | Confirm + start a session (`POST /sessions`) |
| `/sessions` | List caller's sessions (`GET /sessions`) |
| `/sessions/[id]` | Chat: `GET /sessions/:id`, send via `POST /sessions/:id/messages/stream`, optional follow-up + nudge |

## Layout

```text
web/
├── src/
│   ├── app/
│   │   ├── layout.tsx           # providers + toaster
│   │   ├── page.tsx             # redirect("/dashboard")
│   │   ├── globals.css          # tailwind + retro utility classes
│   │   ├── (auth)/{login,register}/page.tsx
│   │   └── (app)/
│   │       ├── layout.tsx       # Navbar + <RequireAuth>
│   │       ├── dashboard/page.tsx
│   │       ├── simulations/page.tsx
│   │       ├── simulations/[slug]/page.tsx
│   │       ├── sessions/page.tsx
│   │       └── sessions/[id]/page.tsx
│   ├── components/
│   │   ├── ui/                  # Retro* + Button + LoadingSpinner + MarkdownMessage + ...
│   │   ├── auth/                # LoginForm, RegisterForm, RequireAuth
│   │   ├── layout/              # Navbar, Providers
│   │   └── chat/                # ChatTranscript, ChatComposer
│   ├── contexts/                # AuthContext, ThemeContext
│   └── lib/
│       ├── api.ts               # typed client for the api/ surface
│       ├── sse.ts               # fetch-based SSE reader
│       └── types.ts             # mirrors api/src/modules/**/*.schema.ts
└── tailwind.config.ts
```

## Scripts

```bash
pnpm dev        # next dev (Turbopack) on :3000
pnpm build      # next build
pnpm start      # next start (after build)
pnpm lint       # next lint
pnpm typecheck  # tsc --noEmit
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL of the `api/` service |

The variable is inlined into the client bundle at build time (note the
`NEXT_PUBLIC_` prefix), so changes require a rebuild in production.

## Design notes

- **The old `frontend/` is untouched.** `web/` is an additive port that only
  talks to the new `api/` service. When the API surface grows (profile,
  analytics, admin), the matching pages can be added here.
- **Retro theme preserved.** `tailwind.config.ts` and `globals.css` mirror
  `frontend/tailwind.config.js` + `frontend/src/index.css` 1:1, so the Retro*
  components look identical to the legacy app.
- **Client-rendered data fetching.** All protected pages are `'use client'`
  components that read the JWT from `localStorage`. Server rendering the
  authenticated surface would require an HTTP-only cookie + a Next.js BFF layer
  — explicitly out of scope for this pass.
- **Streaming is symmetrical with the API.** `message` events are appended to
  a "pending assistant" buffer while rendering; when the `done` event arrives,
  the full `SessionDetail` from the API replaces local state — so persistence
  and canonical ordering come straight from the server.
