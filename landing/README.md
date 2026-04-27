# CareerSIM Landing

Static marketing landing page for `careersim.ai`.

## Why Astro

The landing page is content-first, SEO-sensitive, and does not need app runtime
state. Current static-site-generator comparisons consistently point to Astro as
the strongest default for marketing/content sites because it outputs static HTML
and ships zero browser JavaScript unless a component explicitly needs hydration.
That gives us a fast standalone site without coupling launch marketing to the
authenticated `web/` app.

## Quick Start

```bash
cd landing
pnpm install
pnpm dev
```

## Scripts

```bash
pnpm dev          # local dev server on :4321
pnpm build        # static production build
pnpm preview      # preview the built output
pnpm check        # Astro type/template checks
pnpm sync:figma   # refresh Figma metadata and reference screenshots
```

## Figma Source

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
