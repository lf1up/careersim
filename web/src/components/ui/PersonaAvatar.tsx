'use client';

import React from 'react';
import Image from 'next/image';
import clsx from 'clsx';

import { apiClient } from '@/lib/api';

/**
 * Next.js 16's image optimizer rejects upstream URLs that resolve to private
 * (loopback / RFC1918) IPs as an SSRF guard — see the
 * "upstream image … resolved to private ip" error. That's correct in
 * production but breaks our local/Docker dev where the API lives at
 * `http://localhost:8000` or `http://api:8000`. When the avatar URL points
 * at a private-looking host we set `unoptimized` so the browser fetches the
 * PNG directly (the API still serves a `Cache-Control` header). In
 * production with a public API hostname we keep full optimization.
 */
function pointsAtPrivateHost(rawUrl: string | null): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl, 'http://placeholder.invalid');
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1') return true;
    if (host.startsWith('127.')) return true;
    if (host.startsWith('10.')) return true;
    if (host.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    // Single-label hosts (Docker service names like `api`, `web`) resolve
    // to RFC1918 addresses inside the compose network — same SSRF rejection.
    if (!host.includes('.')) return true;
    return false;
  } catch {
    return false;
  }
}

const FORCE_UNOPTIMIZED =
  process.env.NEXT_PUBLIC_DISABLE_IMAGE_OPTIMIZATION === '1';

/**
 * Source images live at `agent/data/avatars/<slug>.png` and are all
 * 1536x1024 (3:2 landscape). Centralised so any future re-master only
 * needs to update one constant.
 */
const SOURCE_WIDTH = 1536;
const SOURCE_HEIGHT = 1024;

interface PersonaAvatarProps {
  name: string;
  avatarUrl?: string | null;
  slug?: string | null;
  /**
   * Visual treatment.
   * - `square`: fixed-size, square-framed, retro-bordered chip — for grids,
   *   chat headers, and inline use next to a name/badge.
   * - `wide`: full-width, native 3:2 banner — for the simulation detail
   *   hero. Keeps the retro border + shadow but drops the circular crop.
   */
  variant?: 'square' | 'wide';
  /**
   * Rendered side length in CSS pixels for the `square` variant. Drives
   * `width`/`height` on the underlying `<Image>` so Next.js can pick the
   * right `srcset` candidate and prevent layout shift. Ignored when
   * `variant="wide"`.
   */
  size?: number;
  /**
   * Set on the hero avatar (above the fold) so Next.js skips lazy-loading
   * and emits `fetchpriority="high"` for LCP. Leave false elsewhere.
   */
  priority?: boolean;
  /**
   * Persona role/title — folded into the `alt` text for SEO context when
   * provided. The avatar itself is decorative-ish, but on a persona-led
   * page (e.g. the simulation detail hero) the alt text doubles as the
   * page's "who you'll be talking to" anchor.
   */
  roleHint?: string | null;
  /** Optional override for the auto-derived `sizes` attribute. */
  sizes?: string;
  className?: string;
  /**
   * Reveal the full 3:2 landscape source on hover/keyboard focus as a
   * floating overlay anchored to the avatar. Only meaningful for the
   * `square` variant (the `wide` variant already shows the full image).
   * Skipped silently when no avatar source is available (initials fallback).
   */
  previewOnHover?: boolean;
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export function PersonaAvatar({
  name,
  avatarUrl,
  slug,
  variant = 'square',
  size = 32,
  priority = false,
  roleHint,
  sizes,
  className,
  previewOnHover = false,
}: PersonaAvatarProps) {
  const [failed, setFailed] = React.useState(false);

  const src = React.useMemo(() => {
    if (failed) return null;
    if (avatarUrl) return apiClient.personaAvatarUrl(avatarUrl);
    if (slug) return apiClient.personaAvatarUrl(slug);
    return null;
  }, [avatarUrl, failed, slug]);

  const altText = roleHint ? `${name} — ${roleHint}` : name;
  // See `pointsAtPrivateHost` above — keeps Next/Image's SSRF guard from
  // 500-ing on dev/compose URLs while still using the optimizer in prod.
  const unoptimized = FORCE_UNOPTIMIZED || pointsAtPrivateHost(src);

  if (variant === 'wide') {
    // Full-bleed banner: native 3:2, takes the parent's width. The wrapper
    // keeps the retro border + shadow so it still reads as a framed chip,
    // just no longer round/square. `sizes="100vw"` is a reasonable default
    // since the hero typically spans the page width on every breakpoint;
    // callers can override via `sizes` to constrain it.
    const responsiveSizes = sizes ?? '100vw';
    return (
      <div
        className={clsx(
          'relative w-full overflow-hidden border-2 border-black bg-cyan-200 text-retro-ink shadow-retro-2 dark:border-retro-ink-dark dark:bg-cyan-900 dark:text-retro-ink-dark dark:shadow-retro-dark-2',
          className,
        )}
        title={name}
      >
        {src ? (
          <Image
            src={src}
            alt={altText}
            width={SOURCE_WIDTH}
            height={SOURCE_HEIGHT}
            sizes={responsiveSizes}
            priority={priority}
            unoptimized={unoptimized}
            className="block h-auto w-full"
            onError={() => setFailed(true)}
          />
        ) : (
          <div
            className="flex aspect-[3/2] w-full items-center justify-center text-3xl font-semibold"
            aria-label={altText}
          >
            {initials(name)}
          </div>
        )}
      </div>
    );
  }

  // Default `sizes` covers the typical 1x/2x DPR range for this size; callers
  // can override for fluid hero variants (e.g. responsive simulation hero).
  const responsiveSizes = sizes ?? `${size}px`;

  // Only meaningful when there's an actual image to preview; the initials
  // fallback hides the popover entirely.
  const showPreview = previewOnHover && Boolean(src);

  return (
    <span
      // `group/avatar` (named group) so a chat row with multiple sibling
      // groups can still target *this* avatar's preview without leaking to
      // adjacent ones. `tabIndex={0}` is set only for touch devices (where
      // hover doesn't exist) so phone users can tap the chip to reveal
      // the preview; on desktop the chip stays a non-interactive visual
      // and the preview is hover-only.
      className={clsx(
        'group/avatar relative inline-flex shrink-0 items-center justify-center border-2 border-black bg-cyan-200 text-retro-ink shadow-retro-2 dark:border-retro-ink-dark dark:bg-cyan-900 dark:text-retro-ink-dark dark:shadow-retro-dark-2',
        // Only clip the avatar contents themselves, not the floating
        // preview — `overflow-hidden` on the wrapper would scissor the
        // popover. We push clipping down to an inner span instead.
        !showPreview && 'overflow-hidden',
        showPreview && 'focus:outline-none',
        className,
      )}
      style={{ width: size, height: size }}
      title={name}
      // Focusable so touch users can tap the chip to open the preview
      // (no hover on phones). On desktop a click also lands focus here,
      // but the focus-driven reveal below is gated to `(hover: none)`,
      // so desktop clicks don't latch the popover open.
      tabIndex={showPreview ? 0 : undefined}
      aria-hidden={src && !showPreview ? true : undefined}
    >
      <span
        className={clsx(
          'flex h-full w-full items-center justify-center',
          showPreview && 'overflow-hidden',
        )}
      >
        {src ? (
          <Image
            src={src}
            alt={altText}
            width={size}
            height={size}
            sizes={responsiveSizes}
            priority={priority}
            unoptimized={unoptimized}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <span
            className="font-semibold leading-none"
            style={{ fontSize: Math.max(10, Math.round(size * 0.4)) }}
            aria-label={altText}
          >
            {initials(name)}
          </span>
        )}
      </span>
      {showPreview && src && (
        <PersonaPreview
          src={src}
          altText={altText}
          name={name}
          roleHint={roleHint}
          unoptimized={unoptimized}
        />
      )}
    </span>
  );
}

/**
 * Floating "zoom" overlay that renders the avatar at its native 3:2
 * landscape ratio next to the avatar chip on hover/focus. Pure CSS toggle:
 * `pointer-events-none` so the popover never steals hover from the
 * trigger, scaling + opacity transition for a subtle reveal.
 *
 * Anchored to the *right* of the chip and aligned to its top edge. We
 * deliberately avoid `bottom-full` (above the chip) because the chat
 * transcript uses `overflow-y-auto`, which would clip the popover for
 * any message near the top of the scroll viewport.
 *
 * Width is responsive: 216px on small viewports (~10% smaller than the
 * desktop default — keeps the popover comfortably inside the 375px
 * iPhone SE chat panel after avatar gutter + padding), 240px from the
 * `sm` breakpoint up.
 */
const PREVIEW_WIDTH_SM = 216;
const PREVIEW_WIDTH_DEFAULT = 240;

const PersonaPreview: React.FC<{
  src: string;
  altText: string;
  name: string;
  roleHint?: string | null;
  unoptimized: boolean;
}> = ({ src, altText, name, roleHint, unoptimized }) => (
  <span
    role="tooltip"
    aria-hidden="true"
    className={clsx(
      'pointer-events-none absolute left-full top-0 z-50 ml-2',
      // Phone-first: 216px on small screens (iPhone SE), 240px from `sm`
      // (≥640px) up. Tailwind's arbitrary-value width keeps the literal
      // pixels colocated with the `sizes` hint below.
      'w-[216px] sm:w-[240px]',
      // Hidden by default; subtle scale + fade in on reveal.
      'origin-top-left scale-95 opacity-0 transition-all duration-150 ease-out',
      // Hover-capable devices (mouse desktops): hover-only, no click-latch.
      // Tailwind 3+ already gates `hover:` on `(hover: hover)`, so this
      // rule never applies on touch.
      'group-hover/avatar:scale-100 group-hover/avatar:opacity-100',
      // Touch devices (no hover): tap-to-focus reveals the preview. We
      // gate `focus-within` to `@media (hover: none)` so a desktop mouse
      // click that incidentally focuses the chip doesn't toggle the
      // popover open — keeping desktop strictly hover-driven.
      '[@media(hover:none)]:group-focus-within/avatar:scale-100',
      '[@media(hover:none)]:group-focus-within/avatar:opacity-100',
    )}
  >
    <span className="block border-2 border-black bg-white shadow-retro-3 dark:border-retro-ink-dark dark:bg-retro-surface-dark dark:shadow-retro-dark-3">
      <Image
        src={src}
        alt={altText}
        width={SOURCE_WIDTH}
        height={SOURCE_HEIGHT}
        // Match the responsive width above so Next.js asks the optimizer
        // for the right candidate at each breakpoint.
        sizes={`(max-width: 639px) ${PREVIEW_WIDTH_SM}px, ${PREVIEW_WIDTH_DEFAULT}px`}
        unoptimized={unoptimized}
        className="block h-auto w-full"
      />
      <span className="block border-t-2 border-black px-2 py-1.5 text-xs leading-tight dark:border-retro-ink-dark">
        <span className="block font-semibold text-retro-ink dark:text-retro-ink-dark">
          {name}
        </span>
        {roleHint && (
          <span className="block text-secondary-600 dark:text-secondary-400">
            {roleHint}
          </span>
        )}
      </span>
    </span>
  </span>
);
