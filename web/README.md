# 🌐 CareerSIM Web

Next.js 16 (App Router) frontend for the CareerSIM platform. Talks directly to
the Fastify `api/` service for auth, public simulation browsing, sessions, SSE chat, debrief reports, analytics, and billing. The optional creator plugin adds authoring pages through the host extension API.

## 🧱 Stack

- **Runtime**: Node 20+, pnpm
- **Framework**: Next.js 16 (App Router, Turbopack), React 19, TypeScript 6
- **Styling**: Tailwind 3 with the shared retro theme (fonts, shadows,
  light/dark palette ported from `frontend/`)
- **Auth**: HTTP-only session cookie with `credentials: include` on API and SSE requests. `AuthContext` restores the user through `/auth/me`. Registration is email-verified; login
  supports password **or** passwordless magic-link; profile page handles email
  and password rotation
- **CAPTCHA**: [ALTCHA](https://altcha.org) — self-hosted, privacy-friendly,
  proof-of-work challenges rendered by the `altcha` web component. No third
  party
- **Streaming**: `fetch` + `ReadableStream` + `eventsource-parser` for POST-based SSE with session cookies
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

Open [http://localhost:3000](http://localhost:3000) to browse the public `/simulations` catalog. Starting a session and opening account pages require sign-in. With `LANDING_ORIGIN` configured, `/` serves the marketing site instead.

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
| `/auth/callback` | Consume a magic-link token and complete sign-in |
| `/profile` | Account summary; change email (with 6-digit confirmation code); change or set password |
| `/dashboard` | Welcome + counts + recent sessions |
| `/simulations` | Public simulation catalog from `GET /v1/simulations` |
| `/simulations/[slug]` | Public scenario detail; sign in to start a session (`POST /v1/sessions`) |
| `/analytics` | Protected practice totals, skill averages, score trend, and tone distribution |
| `/billing` | Protected subscription status, five usage metrics, payment management, and checkout confirmation |
| `/pricing` | Public three-tier catalog; returns 404 unless `NEXT_PUBLIC_PRICING_ENABLED=true`/`1` |
| `/contact` | Public personal or business inquiry form with ALTCHA |
| `/blog` | Public blog index (Ghost Content API, ISR). Requires `NEXT_PUBLIC_BLOG_ENABLED=true` |
| `/blog/[slug]` | Public blog post with `BlogPosting` JSON-LD. Requires `NEXT_PUBLIC_BLOG_ENABLED=true` |
| `/sessions` | List caller's sessions (`GET /v1/sessions`) |
| `/sessions/[id]` | Chat: `GET /v1/sessions/:id`, send via `POST /v1/sessions/:id/messages/stream`, optional follow-up + nudge. Voice: a **Call** button (when `NEXT_PUBLIC_VOICE_ENABLED` is on and the persona supports voice) opens an in-page WebRTC call surface |

## 🔐 Auth flows

The UI is a thin shell around the API's auth surface (see `api/README.md` for
canonical endpoints):

1. **Register (password or passwordless)** — `POST /auth/register` returns
   `202 { pending, email }`; the UI switches to the 6-digit verify screen.
   `POST /auth/verify-email` consumes the code and sets the session cookie. The UI keeps a chosen password in memory and submits it again at confirmation, so it is activated only after email ownership is proven.
2. **Login (password)** — `POST /auth/login` with ALTCHA payload.
3. **Login (magic link)** — `POST /auth/login/email-link` sends an email;
   the link lands on `/auth/callback?token=…` which calls
   `POST /auth/magic-link/consume` and hydrates `AuthContext`.
4. **Forgot password** — `POST /auth/forgot-password` → email →
   `/reset-password?token=…` → `POST /auth/reset-password`.
5. **Profile** — `PATCH /auth/me/password` and the email-change pair
   `POST /auth/me/email-change` + `POST /auth/me/email-change/confirm`.
6. **Logout** — `POST /auth/logout` revokes the stored login session and clears the cookie. Password resets and password/email changes invalidate earlier login sessions; credential changes issue a fresh session.

Registration, password login, magic-link requests, and forgot-password forms require ALTCHA. Code confirmation, token consumption, and verification resends use their own server checks and rate limits. The widget fetches a
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

## 🎙️ Voice mode

On `/sessions/[id]`, a **Call** button opens a browser-native voice call with
the persona — no install required. The flow:

1. `POST /sessions/:id/voice/start` (via `api.startVoiceCall`) mints a
   short-lived LiveKit token, SFU URL, and `call_id`. The join-token lifetime is separate from the daily allowance.
2. `createVoiceConnection` (`src/lib/voice.ts`) **lazy-imports** `livekit-client`,
   joins the room, publishes the mic, and subscribes to the agent's audio.
3. The `VoiceCallSurface` renders a live **caption strip** (from the
   `voice-captions` data-channel topic) and listens for `voice-control` events
   — a `quota_warning` banner ~60s before the daily budget is spent and a
   `quota_exhausted` cutoff that hard-ends the call with a "Daily N-minute
   voice limit reached" alert.
4. On hang-up `api.endVoiceCall` identifies the call and the API terminates its room. The worker persists spoken turns through internal routes and reports cumulative duration checkpoints; the API debits the UTC daily allowance without trusting browser duration. The session page refreshes the transcript after hang-up while pending turns finish saving.

The whole feature is behind a build-time kill switch: when
`NEXT_PUBLIC_VOICE_ENABLED=false`, `isVoiceEnabledClientSide()` returns `false`,
the Call button renders nothing, and `livekit-client` is never imported. The
button is also hidden for personas that don't declare a `voice` block and for group scenes. See the
repo-level [VOICE_MODE.md](../VOICE_MODE.md) for the end-to-end picture.

## 💳 Subscriptions and account usage

`/pricing` reads the API's Free, Plus, and Supporter catalog, including monthly/yearly prices and five independent limits. `/billing` reads effective access, renewal/cancellation status, and usage. Session starts and text messages use separate configured windows. Custom simulations and personas count current owned inventory; voice resets at midnight UTC. The API enforces these limits across billing intervals and tier changes.

`NEXT_PUBLIC_PRICING_ENABLED` is off by default. Enabling it exposes `/pricing` and pricing links; it does not enable purchases. The API independently requires `BILLING_ENABLED=true` and provider configuration. When pricing is hidden, account status and payment management remain available. Supporter availability comes from the API catalog, including its product and private-channel configuration.

Checkout and payment management use hosted Polar pages. The return page refreshes provider state and can show confirmation pending; a return URL does not prove payment. Self-service plan changes are disabled, so the UI offers contact instead. Supporter instructions are fetched only for eligible accounts. API responses provide all prices and caps; the web app does not maintain a separate pricing table. See the [billing runbook](../docs/BILLING.md) for configuration and provider verification.

## 🔌 Optional plugin pages

The web host copies selected extension API v2 plugins at development/build time. Plugins can add pages, navigation, and crawl restrictions, using the host's cookie-aware API helper and auth context. Creator authoring lives in the separate private `careersim-studio` repository. Use matching API/web plugin selections and compatible revisions. See [plugin setup](../README.md#-plugin-support) for local watchers and the `CAREERSIM_PLUGIN_*` settings.

## 📰 Headless Ghost blog

Posts are authored in Ghost and rendered by Next.js at `/blog` (subdirectory
on the main domain for SEO). Ghost itself is Content-API-only — put the Ghost
frontend in **Private Site Mode** so search engines don't index a duplicate
copy at `:2368`.

### 🚦 Feature flag

The blog is gated by `isBlogEnabled()` in `src/lib/blog.ts`: it needs
`NEXT_PUBLIC_BLOG_ENABLED=true`/`1` **and** Ghost Content API env
(`GHOST_API_URL` + `GHOST_CONTENT_API_KEY`). The flag is **off by default** —
omit `NEXT_PUBLIC_BLOG_ENABLED` entirely, or set `false`/`0`, and the surface
stays off. Discovery links live on the **landing** site header/footer only when
`LANDING_BLOG_URL` is set (also unset by default) — not in the app navbar.

| Condition | Behavior |
| --- | --- |
| Flag omitted / unset / `false` / `0`, or missing `GHOST_API_URL` / `GHOST_CONTENT_API_KEY` | Blog **off** (default) — `/blog` and `/blog/[slug]` return 404, sitemap / robots / `llms.txt` omit blog URLs, `POST /api/revalidate` returns 503 |
| Flag `true` / `1` **and** Ghost URL + Content API key set | Blog **on** |

Because the flag is `NEXT_PUBLIC_*`, it is inlined at build / `pnpm dev` start —
restart `web` (or recreate the compose `web` service) after changing it.

### 🛠️ One-time local setup

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
│   ├── proxy.ts                             # apex → landing origin (strips noindex)
│   ├── app/
│   │   ├── layout.tsx                       # providers + toaster
│   │   ├── page.tsx                         # redirect("/simulations")
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
│   │       ├── analytics/page.tsx
│   │       ├── billing/page.tsx
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
pnpm lint       # eslint .
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run
```

## 🌱 Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/v1` | **Full base URL** of the `api/` service, version path included — nothing is appended in code, so this single var controls which version the frontend talks to (e.g. on Vercel: `https://api.careersim.ai/v1`, or the bare origin for an API running without `API_VERSION_PREFIX`). Must match the API's actual prefix. Also used by `AltchaWidget` (`{url}/auth/challenge`) and by `next/image` to derive the allowed avatar path |
| `API_INTERNAL_URL` | unset (falls back to `NEXT_PUBLIC_API_URL`) | Server-side override with the same full-URL semantics, for when the Next server reaches the API over a different network than the browser (compose sets `http://api:8000/v1`). Keep its version path identical to `NEXT_PUBLIC_API_URL`'s |
| `NEXT_PUBLIC_SITE_URL` | `https://<VERCEL_URL>` or `https://careersim.local` | Canonical public site origin for metadata and discovery files; match landing's `LANDING_SITE_URL` |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hello@careersim.local` | Public support/contact email displayed in the app footer |
| `NEXT_PUBLIC_VOICE_ENABLED` | `true` | Build-time kill switch for voice mode. `false` hides the Call button and skips the `livekit-client` import entirely. Should match `VOICE_ENABLED` on `api`/`agent` |
| `NEXT_PUBLIC_LIVEKIT_URL` | `ws://localhost:7880` | LiveKit SFU endpoint as reachable **from the browser** (not the in-compose `ws://livekit:7880` hostname) |
| `LANDING_ORIGIN` | unset | Optional origin for the Astro landing deployment. When set, `src/proxy.ts` fetches `/`, `/business`, legal pages, `/_astro/*`, and `/favicon.svg` from that origin so `web` can serve as the single-domain front door, and strips the landing project's `x-robots-tag: noindex` (Vercel Standard Protection) so the apex stays indexable. Contact form APIs stay on `web` (`/api/altcha-challenge`, `/api/contact`) so they share the apex challenge session. Marketing pages also send Web Analytics to this project's `/_vercel/insights/*` — enable Web Analytics on the **web** Vercel project |
| `RESEND_API_KEY` | unset | Resend API key for `/business` contact-form delivery |
| `CONTACT_FROM_EMAIL` | `onboarding@resend.dev` | Verified Resend sender for inquiry emails |
| `CONTACT_TO_EMAIL` | falls back to `NEXT_PUBLIC_CONTACT_EMAIL` | Inbox that receives `/business` inquiries |
| `ALTCHA_HMAC_KEY` | unset | Must match the API and standalone landing projects. Authenticates visitor-IP metadata sent to the shared CAPTCHA verifier; never expose it to the browser |
| `NEXT_PUBLIC_BLOG_ENABLED` | unset / `false` | Opt-in for the blog (**off by default**). Omit the var, or set `false`/`0`, to keep it off. `true`/`1` plus `GHOST_API_URL` + `GHOST_CONTENT_API_KEY` enables `/blog`; otherwise routes 404 and sitemap / robots / `llms.txt` omit blog URLs. Landing links use `LANDING_BLOG_URL` (separate, also unset by default) |
| `NEXT_PUBLIC_PRICING_ENABLED` | unset / `false` | Pricing is disabled by default. Only `true`/`1` enables it. Otherwise pricing links in desktop/mobile navigation, billing, and quota notices are hidden, and `/pricing` returns 404 before loading plans. Contact forms, payment management, and API entitlements remain available. Match `LANDING_PRICING_ENABLED` in landing and rebuild both apps after changing flags. |
| `GHOST_API_URL` | `http://localhost:2368` | Ghost Content API origin (compose overrides to `http://ghost:2368`). Required with the Content API key for the blog to enable |
| `GHOST_PUBLIC_URL` | unset | Optional browser-facing Ghost origin for `next/image` when it differs from `GHOST_API_URL` |
| `GHOST_CONTENT_API_KEY` | unset | Read-only Content API key from Ghost Admin → Integrations. Required with `GHOST_API_URL` for the blog to enable |
| `GHOST_WEBHOOK_SECRET` | unset | Shared secret for `POST /api/revalidate?secret=…` (instant ISR on publish) |

`NEXT_PUBLIC_API_URL` is inlined into the client bundle at build time (note the
`NEXT_PUBLIC_` prefix), so changes require a rebuild in production. The same
applies to other `NEXT_PUBLIC_*` values such as `NEXT_PUBLIC_CONTACT_EMAIL`,
`NEXT_PUBLIC_VOICE_ENABLED`, `NEXT_PUBLIC_BLOG_ENABLED`, and `NEXT_PUBLIC_PRICING_ENABLED`.
The production Docker image also hides pricing by default. Pass
`--build-arg NEXT_PUBLIC_PRICING_ENABLED=true` when building to enable pricing
in both the server and browser bundles.
`LANDING_ORIGIN` is server-side (read by `src/proxy.ts` and used at build
time for `NEXT_PUBLIC_HAS_LANDING_ORIGIN`); set it to the landing project's
deployment origin, for example `https://careersim-landing.vercel.app`.

No ALTCHA configuration lives on the client — the widget only sees the
signed challenge payload. Auth forms use `api/.env` (`ALTCHA_HMAC_KEY`,
`ALTCHA_MAX_NUMBER`). The `/business` contact form proxies challenge issuance
and single-use verification to that API. Set the same `ALTCHA_HMAC_KEY` here,
and configure `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, and `CONTACT_TO_EMAIL`
on the web project. Only the API configures proof-of-work difficulty.

## 🎨 Design notes

- **The old `frontend/` is untouched.** `web/` is an additive port that only
  talks to the new `api/` service. Analytics, reports, and billing are implemented here; there is no legacy admin panel.
- **Retro theme preserved.** `tailwind.config.ts` and `globals.css` mirror
  `frontend/tailwind.config.js` + `frontend/src/index.css` 1:1, so the Retro*
  components look identical to the legacy app.
- **Client-rendered data fetching.** All protected pages are `'use client'`
  components that use `AuthContext` and cookie-authenticated API requests. Both the `(auth)` and
  `(app)` route groups are marked `dynamic = 'force-dynamic'` because
  `RequireAuth`, the auth forms, and the magic-link callback all rely on
  `useSearchParams` + `useAuth`, which can't be evaluated at build time.
  Authentication is restored from the API rather than a client-stored token.
- **ALTCHA over third-party CAPTCHAs.** We chose ALTCHA because it runs
  entirely against our own API, has no cross-origin tracking, and degrades
  gracefully (the widget is a Web Component with a lazy dynamic import, so
  it never blocks initial paint). See `AltchaWidget.tsx` for the React
  wrapper.
- **Streaming preserves interrupted replies.** The API persists text and voice message events before forwarding them. The chat UI buffers rapid user messages into a batch, displays actor-aware replies, and replaces local state with the canonical session on `done`. A new send can interrupt the current stream; `expected_message_count` lets the API reject stale submissions before generation. Proactive follow-ups persist only at `done`.
- **Voice never bloats the base bundle.** `livekit-client` is imported lazily
  inside `createVoiceConnection`, so a build with `NEXT_PUBLIC_VOICE_ENABLED=false`
  (or a user who never starts a call) never pays its wheel cost. Captions and
  budget banners are best-effort UX driven by LiveKit data-channel frames; the
  authoritative transcript + quota live on the server, mirroring the chat
  surface.
- **Blog is an opt-in public surface.** It stays off when
  `NEXT_PUBLIC_BLOG_ENABLED` is omitted or not `true`/`1`, or when Ghost
  Content API env is missing; otherwise App Router pages 404 and crawl
  surfaces omit blog URLs. Marketing links to `/blog` appear on the landing
  site only when `LANDING_BLOG_URL` is set (unset by default), not in the app
  navbar.

---

## 🕷️ Crawling and discovery

The web app owns `/sitemap.xml`, `/robots.txt`, and `/llms.txt` for the canonical
site, including marketing pages served through `LANDING_ORIGIN`. Public-page
definitions live in `src/lib/crawl-pages.ts`. The discovery files refresh every
five minutes; the Ghost webhook also invalidates the sitemap and `llms.txt`.

- Contact, the simulation catalog, public simulation details, sign-in, and signup
  are included. Sign-in and signup deliberately remain indexable.
- Pricing appears only when `NEXT_PUBLIC_PRICING_ENABLED=true`/`1`. Blog pages
  and posts require both the blog flag and Ghost credentials.
- Home, Business, Privacy, Terms, and Security are included only when
  `LANDING_ORIGIN` is configured. Without it, `/` redirects to the catalog and
  the other marketing routes are not served by this app.
- Private account, analytics, session, authentication-action, and API routes are
  excluded. Plugin crawl restrictions are preserved. Namespaced private
  simulations are excluded from both the sitemap and `llms.txt`.
- Sitemap URLs are canonical and deduplicated. Modification dates are emitted
  only when the CMS supplies a valid update or publication date.

Set `NEXT_PUBLIC_SITE_URL` and landing's `LANDING_SITE_URL` to the same public
canonical origin. The landing deployment does not generate a competing sitemap
or robots file. Robots rules manage crawling; private pages retain their
authentication and `noindex` metadata.

`src/app/crawl.test.ts` checks the feature combinations and classifies every
current page route so new routes cannot silently bypass this review.

## 📜 License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## 👤 Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
