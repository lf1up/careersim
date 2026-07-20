# 🌐 CareerSIM Web

Next.js 16 (App Router) frontend for the CareerSIM platform. Talks directly to
the Fastify `api/` service — auth, simulations, personas, sessions, and the SSE
streaming surface. No admin panel, no socket.io, no analytics: those belong to
the legacy `frontend/` app and are not backed by the new API.

## 🧱 Stack

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
- **Voice**: browser-native WebRTC call surface over `livekit-client` (lazy
  dynamic import so it only loads when a call starts), gated by
  `NEXT_PUBLIC_VOICE_ENABLED`

## 🚀 Quick start

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

## 📄 Pages

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
| `/blog` | Public blog index (Ghost Content API, ISR). Requires `NEXT_PUBLIC_BLOG_ENABLED=true` |
| `/blog/[slug]` | Public blog post with `BlogPosting` JSON-LD. Requires `NEXT_PUBLIC_BLOG_ENABLED=true` |
| `/sessions` | List caller's sessions (`GET /sessions`) |
| `/sessions/[id]` | Chat: `GET /sessions/:id`, send via `POST /sessions/:id/messages/stream`, optional follow-up + nudge. Voice: a **Call** button (when `NEXT_PUBLIC_VOICE_ENABLED` is on and the persona supports voice) opens an in-page WebRTC call surface |

## 🔐 Auth flows

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

### 🛑 Rate limiting

The API applies `@fastify/rate-limit` policies on top of ALTCHA (see
`api/README.md` for the full table). When a user crosses a limit the
server responds `429` with a `{ error: "RATE_LIMITED", message,
retryAfter }` envelope — the shared `apiClient` surfaces that payload as
an `ApiError` whose `code` is `RATE_LIMITED`, and every auth form renders
it as an inline `RetroAlert` so the user sees the `retryAfter` window
without a page reload. No client-side throttling is needed — the server
is the single source of truth and the 429 body already carries everything
the UI needs to display.

## Voice mode

On `/sessions/[id]`, a **Call** button opens a browser-native voice call with
the persona — no install required. The flow:

1. `POST /sessions/:id/voice/start` (via `api.startVoiceCall`) mints a
   short-lived LiveKit token + SFU URL.
2. `createVoiceConnection` (`src/lib/voice.ts`) **lazy-imports** `livekit-client`,
   joins the room, publishes the mic, and subscribes to the agent's audio.
3. The `VoiceCallSurface` renders a live **caption strip** (from the
   `voice-captions` data-channel topic) and listens for `voice-control` events
   — a `quota_warning` banner ~60s before the daily budget is spent and a
   `quota_exhausted` cutoff that hard-ends the call with a "Daily N-minute
   voice limit reached" alert.
4. On hang-up `api.endVoiceCall` marks the call ended; the authoritative
   quota debit and transcript persistence happen server-side via the
   `agent-voice` worker, so the chat transcript reflects the spoken turns when
   you return to text mode.

The whole feature is behind a build-time kill switch: when
`NEXT_PUBLIC_VOICE_ENABLED=false`, `isVoiceEnabledClientSide()` returns `false`,
the Call button renders nothing, and `livekit-client` is never imported. The
button is also hidden for personas that don't declare a `voice` block. See the
repo-level [VOICE_MODE.md](../VOICE_MODE.md) for the end-to-end picture.

## 📰 Headless Ghost blog

Posts are authored in Ghost and rendered by Next.js at `/blog` (subdirectory
on the main domain for SEO). Ghost itself is Content-API-only — put the Ghost
frontend in **Private Site Mode** so search engines don't index a duplicate
copy at `:2368`.

### Feature flag

The blog is gated by `isBlogEnabled()` in `src/lib/blog.ts`: it needs
`NEXT_PUBLIC_BLOG_ENABLED=true`/`1` **and** Ghost Content API env
(`GHOST_API_URL` + `GHOST_CONTENT_API_KEY`). Missing either keeps the surface
off. Discovery links live on the **landing** site header/footer only when
`LANDING_BLOG_URL` is set — not in the app navbar.

| Condition | Behavior |
| --- | --- |
| Flag unset / `false` / `0`, or missing `GHOST_API_URL` / `GHOST_CONTENT_API_KEY` | Blog **off** (default) — `/blog` and `/blog/[slug]` return 404, sitemap / robots / `llms.txt` omit blog URLs, `POST /api/revalidate` returns 503 |
| Flag `true` / `1` **and** Ghost URL + Content API key set | Blog **on** |

Because the flag is `NEXT_PUBLIC_*`, it is inlined at build / `pnpm dev` start —
restart `web` (or recreate the compose `web` service) after changing it.

### One-time local setup

1. Start the stack (`docker compose -f docker-compose.local.yml up`) so
   `ghost` is listening on [http://localhost:2368](http://localhost:2368).
2. Open [http://localhost:2368/ghost](http://localhost:2368/ghost) and finish
   the Ghost setup wizard (create the owner account).
3. **Settings → General → Make this site private** — enable Private Mode
   (password-protects Ghost's own frontend + `noindex`).
4. **Settings → Integrations → Add custom integration** named e.g.
   `Next.js Frontend`. Copy the **Content API Key** into
   `GHOST_CONTENT_API_KEY` in `web/.env`.
5. On that same integration, add webhooks:
   - Events: **Post published**, **Post updated**, **Post deleted**
   - Target URL (all-Compose stack — Ghost and Next both in Docker):
     `http://web:3000/api/revalidate?secret=<GHOST_WEBHOOK_SECRET>`
   - Target URL (Next on the host, Ghost in Docker only):
     `http://host.docker.internal:3000/api/revalidate?secret=<GHOST_WEBHOOK_SECRET>`
   - Production: use your public site URL. Set a matching random value in
     `GHOST_WEBHOOK_SECRET`.
6. Restart `web` (or re-run `pnpm dev`) so it picks up the new env vars.
7. Publish a post in Ghost Admin — it should appear at `/blog` within the
   ISR window (or immediately via the webhook).

Compose sets `GHOST_API_URL=http://ghost:2368` for the `web` container.
When running Next on the host against compose Ghost, keep
`GHOST_API_URL=http://localhost:2368` in `web/.env`.

In production, give Ghost a public origin (e.g. `https://ghost.careersim.ai`)
for admin + Content API + feature images, set that as Ghost's `url` and as
`GHOST_API_URL` / `GHOST_PUBLIC_URL` on `web`, and keep Private Mode on.

## 📁 Layout

```text
web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                       # providers + toaster
│   │   ├── page.tsx                         # redirect("/dashboard")
│   │   ├── globals.css                      # tailwind + retro utility classes
│   │   ├── sitemap.ts / robots.ts           # SEO crawl surfaces (incl. /blog)
│   │   ├── api/revalidate/route.ts          # Ghost publish webhook → ISR
│   │   ├── (public)/
│   │   │   ├── layout.tsx                   # Navbar + Footer (no auth guard)
│   │   │   ├── simulations/...
│   │   │   └── blog/
│   │   │       ├── page.tsx                 # post listing
│   │   │       ├── [slug]/page.tsx          # post detail + BlogPosting JSON-LD
│   │   │       └── ghost-content.css        # Koenig kg-* card styles
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
│   │       ├── sessions/page.tsx
│   │       └── sessions/[id]/page.tsx
│   ├── components/
│   │   ├── ui/                              # Retro* + Button + LoadingSpinner + MarkdownMessage + ...
│   │   ├── auth/                            # LoginForm, RegisterForm, ForgotPasswordForm,
│   │   │                                    # ResetPasswordForm, ProfilePage, MagicLinkCallback,
│   │   │                                    # VerifyCodeCard, CheckYourInboxCard, AltchaWidget,
│   │   │                                    # RequireAuth
│   │   ├── layout/                          # Navbar, Providers
│   │   ├── chat/                            # ChatTranscript, ChatComposer
│   │   └── voice/                           # VoiceCallButton, VoiceCallSurface, VoiceControls
│   ├── contexts/                            # AuthContext, ThemeContext
│   └── lib/
│       ├── api.ts                           # typed client for the api/ surface (incl. start/endVoiceCall)
│       ├── blog.ts                          # isBlogEnabled() — NEXT_PUBLIC_BLOG_ENABLED kill switch
│       ├── ghost.ts                         # @tryghost/content-api helpers (paginated)
│       ├── sanitize-html.ts                 # DOMPurify wrapper for Ghost HTML
│       ├── seo.ts                           # metadataFor / absoluteUrl helpers
│       ├── sse.ts                           # fetch-based SSE reader
│       ├── voice.ts                         # livekit-client wrapper (lazy import) + kill-switch helper
│       └── types.ts                         # mirrors api/src/modules/**/*.schema.ts (incl. Voice* types)
└── tailwind.config.ts
```

## ⚙️ Scripts

```bash
pnpm dev        # next dev (Turbopack) on :3000
pnpm build      # next build
pnpm start      # next start (after build)
pnpm lint       # next lint
pnpm typecheck  # tsc --noEmit
```

## 🌱 Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL of the `api/` service. Also used by `AltchaWidget` to fetch `/auth/challenge` |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hello@careersim.local` | Public support/contact email displayed in the app footer |
| `NEXT_PUBLIC_VOICE_ENABLED` | `true` | Build-time kill switch for voice mode. `false` hides the Call button and skips the `livekit-client` import entirely. Should match `VOICE_ENABLED` on `api`/`agent` |
| `NEXT_PUBLIC_LIVEKIT_URL` | `ws://localhost:7880` | LiveKit SFU endpoint as reachable **from the browser** (not the in-compose `ws://livekit:7880` hostname) |
| `LANDING_ORIGIN` | unset | Optional origin for the Astro landing deployment. When set, `web` rewrites `/`, `/_astro/*`, and `/favicon.svg` to that origin so `web` can serve as the single-domain front door |
| `NEXT_PUBLIC_BLOG_ENABLED` | `false` | Opt-in for the blog. Also requires `GHOST_API_URL` + `GHOST_CONTENT_API_KEY`. Unset/`false`/missing Ghost credentials 404s `/blog` and omits blog URLs from sitemap / robots / `llms.txt`. Landing links use `LANDING_BLOG_URL` |
| `GHOST_API_URL` | `http://localhost:2368` | Ghost Content API origin (compose overrides to `http://ghost:2368`). Required with the Content API key for the blog to enable |
| `GHOST_PUBLIC_URL` | unset | Optional browser-facing Ghost origin for `next/image` when it differs from `GHOST_API_URL` |
| `GHOST_CONTENT_API_KEY` | unset | Read-only Content API key from Ghost Admin → Integrations. Required with `GHOST_API_URL` for the blog to enable |
| `GHOST_WEBHOOK_SECRET` | unset | Shared secret for `POST /api/revalidate?secret=…` (instant ISR on publish) |

`NEXT_PUBLIC_API_URL` is inlined into the client bundle at build time (note the
`NEXT_PUBLIC_` prefix), so changes require a rebuild in production. The same
applies to other `NEXT_PUBLIC_*` values such as `NEXT_PUBLIC_CONTACT_EMAIL`,
`NEXT_PUBLIC_VOICE_ENABLED`, and `NEXT_PUBLIC_BLOG_ENABLED`.
`LANDING_ORIGIN` is server-side Next.js config used by rewrites; set it to the
landing project's deployment origin, for example
`https://careersim-landing.vercel.app`.

No ALTCHA configuration lives on the client — the HMAC key, challenge TTL,
and PoW difficulty are all server-side (`ALTCHA_HMAC_KEY`,
`ALTCHA_MAX_NUMBER` in `api/.env`). The widget only sees the signed
challenge payload.

## 🎨 Design notes

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
- **Voice never bloats the base bundle.** `livekit-client` is imported lazily
  inside `createVoiceConnection`, so a build with `NEXT_PUBLIC_VOICE_ENABLED=false`
  (or a user who never starts a call) never pays its wheel cost. Captions and
  budget banners are best-effort UX driven by LiveKit data-channel frames; the
  authoritative transcript + quota live on the server, mirroring the chat
  surface.
- **Blog is an opt-in public surface.** It stays off unless
  `NEXT_PUBLIC_BLOG_ENABLED=true` and Ghost Content API env are both set;
  otherwise App Router pages 404 and crawl surfaces omit blog URLs.
  Marketing links to `/blog` appear on the landing site only when
  `LANDING_BLOG_URL` is set, not in the app navbar.

---

## 📜 License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## 👤 Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
