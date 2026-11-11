# 🏠 CareerSIM Landing

Static marketing landing page for `careersim.ai`.

## 🤔 Why Astro

The landing page is content-first, SEO-sensitive, and does not need app runtime
state. Current static-site-generator comparisons consistently point to Astro as
the strongest default for marketing/content sites because it outputs static HTML
and ships zero browser JavaScript unless a component explicitly needs hydration.
That gives us a fast standalone site without coupling launch marketing to the
authenticated `web/` app.

## 🚀 Quick Start

```bash
cd landing
pnpm install
pnpm dev
```

Copy `.env.example` to `.env` and adjust as needed. Blog nav/footer links stay
hidden unless you set `LANDING_BLOG_URL` (leave it unset by default to match
`web` when `NEXT_PUBLIC_BLOG_ENABLED` is omitted or false).

The creator beta section is hidden by default. Set `LANDING_CREATOR_ENABLED=true`
(or `1`) in the landing project's build environment to show it after the personas
section. Its button links to `/create` on the `LANDING_APP_URL` origin. Enable it
only when the creator plugin is live in the app. This page is static, so rebuild
and redeploy after changing the flag.

Pricing is disabled by default in both apps. Set `LANDING_PRICING_ENABLED=true`
(or `1`) to show Pricing in the homepage and legal-page footers, and set
`NEXT_PUBLIC_PRICING_ENABLED=true` in web to enable its pricing links and
`/pricing` page. Unset, empty, `false`, and `0` keep pricing hidden. Rebuild and redeploy both
apps after changing these flags. Contact forms and links remain available.
The homepage, legal-page, and business-page Contact footer links open `/contact` on the
`LANDING_APP_URL` origin.
The homepage, Privacy, Terms, and Security pages share `LandingFooter.astro`.
After building, run `pnpm test:footers` to compare their rendered footers and
link destinations.

The `/business` contact form on `careersim.ai` is handled by the `web`
package (`/api/contact`, `/api/altcha-challenge`). Set `RESEND_API_KEY`,
`CONTACT_*`, and `ALTCHA_HMAC_KEY` in the web Vercel project. The HMAC key must
match the API's key. Standalone landing API routes proxy to `LANDING_SITE_URL`;
configure that origin and the same `ALTCHA_HMAC_KEY` here when using them.

Web Analytics on proxied pages (`/`, `/business`, legal) also goes through
the apex: landing injects `/_vercel/insights/*`, which is served by the
**web** Vercel project. Enable Web Analytics there (not only on landing).

## ⚙️ Scripts

```bash
pnpm dev          # local dev server on :4321
pnpm build        # static production build
pnpm preview      # preview the built output
pnpm check        # Astro type/template checks
pnpm test:footers # compare homepage/legal footers after pnpm build
pnpm sync:figma   # refresh Figma metadata and reference screenshots
```

## 🎨 Figma Source

The source design is saved in `figma/design-source.json`.

To manually refresh Figma metadata and reference renders:

```bash
cd landing
cp .env.example .env
# set FIGMA_TOKEN in .env, then load it in your shell
set -a && source .env && set +a
pnpm sync:figma
```

The sync writes:

- `figma/file.json` — lightweight Figma file metadata
- `figma/nodes.json` — raw desktop/mobile node data
- `figma/sync-summary.json` — sync timestamp and exported asset paths
- `public/figma/desktop.png` and `public/figma/mobile.png` — visual references

The production page is intentionally hand-adapted from Figma in Astro + CSS
rather than generated directly from Figma output.

---

## 📜 License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## 👤 Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
