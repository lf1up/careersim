# CareerSIM Web

Next.js 16 (App Router) frontend for the CareerSIM platform. Talks directly to
the Fastify `api/` service — auth, simulations, personas, sessions, and the SSE
streaming surface. No admin panel, no socket.io, no analytics: those belong to
the legacy `frontend/` app and are not backed by the new API.

## Stack

- **Runtime**: Node 20+, pnpm
- **Framework**: Next.js 16 (App Router, Turbopack), React 19, TypeScript 6
- **Styling**: Tailwind 3 with the shared retro theme (fonts, shadows,
  light/dark palette ported from `frontend/`)
- **Auth**: JWT stored in `localStorage` + `Authorization: Bearer` header (no
  HTTP-only cookie / BFF layer yet). Registration is email-verified; login
  supports password **or** passwordless magic-link; profile page handles email
  and password rotation
- **CAPTCHA**: [ALTCHA](https://altcha.org) — self-hosted, privacy-friendly,
  proof-of-work challenges rendered by the `altcha` web component. No third
  party
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

> In local dev, outbound emails (verification codes, magic links, password
> resets) are logged to the API's stdout when `SMTP_HOST` is empty — copy the
> 6-digit code or the reset URL straight from the `pnpm dev` output.

## Pages

| Path | Purpose |
| --- | --- |
| `/register` | Tabbed sign-up (password **or** passwordless). Sends a 6-digit verification code; ALTCHA-gated |
| `/login` | Password sign-in **or** request a magic link. ALTCHA-gated |
| `/forgot-password` | Request a password-reset email. ALTCHA-gated |
| `/reset-password` | Consume a reset token from the email and set a new password |
| `/auth/callback` | Consume magic-link / verification tokens and complete sign-in |
| `/profile` | Account summary; change email (with 6-digit confirmation code); change or set password |
| `/dashboard` | Welcome + counts + recent sessions |
| `/simulations` | List simulations from `GET /simulations` |
| `/simulations/[slug]` | Confirm + start a session (`POST /sessions`) |
| `/sessions` | List caller's sessions (`GET /sessions`) |
| `/sessions/[id]` | Chat: `GET /sessions/:id`, send via `POST /sessions/:id/messages/stream`, optional follow-up + nudge |

## Auth flows

The UI is a thin shell around the API's auth surface (see `api/README.md` for
canonical endpoints):

1. **Register (password or passwordless)** — `POST /auth/register` returns
   `202 { pending, email }`; the UI switches to the 6-digit verify screen.
   `POST /auth/verify-email` consumes the code and returns `{ user, token }`.
2. **Login (password)** — `POST /auth/login` with ALTCHA payload.
3. **Login (magic link)** — `POST /auth/login/email-link` sends an email;
   the link lands on `/auth/callback?token=…` which calls
   `POST /auth/consume-link` and hydrates `AuthContext`.
4. **Forgot password** — `POST /auth/forgot-password` → email →
   `/reset-password?token=…` → `POST /auth/reset-password`.
5. **Profile** — `POST /auth/change-password` and the email-change pair
   `POST /auth/request-email-change` + `POST /auth/confirm-email-change`.

Every public-facing mutation endpoint is gated by ALTCHA; the widget fetches a
signed challenge from `${NEXT_PUBLIC_API_URL}/auth/challenge`, solves it
locally in the browser, and the resulting payload is posted alongside the
form body. Submit buttons stay disabled until the widget emits a `verified`
state, and the payload is reset automatically on error so users can retry
without a page reload.

### Rate limiting

The API applies `@fastify/rate-limit` policies on top of ALTCHA (see
`api/README.md` for the full table). When a user crosses a limit the
server responds `429` with a `{ error: "RATE_LIMITED", message,
retryAfter }` envelope — the shared `apiClient` surfaces that payload as
an `ApiError` whose `code` is `RATE_LIMITED`, and every auth form renders
it as an inline `RetroAlert` so the user sees the `retryAfter` window
without a page reload. No client-side throttling is needed — the server
is the single source of truth and the 429 body already carries everything
the UI needs to display.

## Layout

```text
web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                       # providers + toaster
│   │   ├── page.tsx                         # redirect("/dashboard")
│   │   ├── globals.css                      # tailwind + retro utility classes
│   │   ├── (auth)/
│   │   │   ├── layout.tsx                   # force-dynamic (useSearchParams)
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   ├── forgot-password/page.tsx
│   │   │   ├── reset-password/page.tsx
│   │   │   └── auth/callback/page.tsx       # magic-link / verify-email token sink
│   │   └── (app)/
│   │       ├── layout.tsx                   # Navbar + <RequireAuth> (force-dynamic)
│   │       ├── dashboard/page.tsx
│   │       ├── profile/page.tsx
│   │       ├── simulations/page.tsx
│   │       ├── simulations/[slug]/page.tsx
│   │       ├── sessions/page.tsx
│   │       └── sessions/[id]/page.tsx
│   ├── components/
│   │   ├── ui/                              # Retro* + Button + LoadingSpinner + MarkdownMessage + ...
│   │   ├── auth/                            # LoginForm, RegisterForm, ForgotPasswordForm,
│   │   │                                    # ResetPasswordForm, ProfilePage, MagicLinkCallback,
│   │   │                                    # VerifyCodeCard, CheckYourInboxCard, AltchaWidget,
│   │   │                                    # RequireAuth
│   │   ├── layout/                          # Navbar, Providers
│   │   └── chat/                            # ChatTranscript, ChatComposer
│   ├── contexts/                            # AuthContext, ThemeContext
│   └── lib/
│       ├── api.ts                           # typed client for the api/ surface
│       ├── sse.ts                           # fetch-based SSE reader
│       └── types.ts                         # mirrors api/src/modules/**/*.schema.ts
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
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL of the `api/` service. Also used by `AltchaWidget` to fetch `/auth/challenge` |
| `LANDING_ORIGIN` | unset | Optional origin for the Astro landing deployment. When set, `web` rewrites `/`, `/_astro/*`, and `/favicon.svg` to that origin so `web` can serve as the single-domain front door |

`NEXT_PUBLIC_API_URL` is inlined into the client bundle at build time (note the
`NEXT_PUBLIC_` prefix), so changes require a rebuild in production. `LANDING_ORIGIN`
is server-side Next.js config used by rewrites; set it to the landing project's
deployment origin, for example `https://careersim-landing.vercel.app`.

No ALTCHA configuration lives on the client — the HMAC key, challenge TTL,
and PoW difficulty are all server-side (`ALTCHA_HMAC_KEY`,
`ALTCHA_MAX_NUMBER` in `api/.env`). The widget only sees the signed
challenge payload.

## Design notes

- **The old `frontend/` is untouched.** `web/` is an additive port that only
  talks to the new `api/` service. When the API surface grows (analytics,
  admin), the matching pages can be added here.
- **Retro theme preserved.** `tailwind.config.ts` and `globals.css` mirror
  `frontend/tailwind.config.js` + `frontend/src/index.css` 1:1, so the Retro*
  components look identical to the legacy app.
- **Client-rendered data fetching.** All protected pages are `'use client'`
  components that read the JWT from `localStorage`. Both the `(auth)` and
  `(app)` route groups are marked `dynamic = 'force-dynamic'` because
  `RequireAuth`, the auth forms, and the magic-link callback all rely on
  `useSearchParams` + `useAuth`, which can't be evaluated at build time.
  Server rendering the authenticated surface would require an HTTP-only
  cookie + a Next.js BFF layer — explicitly out of scope for this pass.
- **ALTCHA over third-party CAPTCHAs.** We chose ALTCHA because it runs
  entirely against our own API, has no cross-origin tracking, and degrades
  gracefully (the widget is a Web Component with a lazy dynamic import, so
  it never blocks initial paint). See `AltchaWidget.tsx` for the React
  wrapper.
- **Streaming is symmetrical with the API.** `message` events are appended to
  a "pending assistant" buffer while rendering; when the `done` event arrives,
  the full `SessionDetail` from the API replaces local state — so persistence
  and canonical ordering come straight from the server.
