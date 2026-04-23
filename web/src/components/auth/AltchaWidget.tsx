'use client';

// Pulls in the ambient JSX typing for `<altcha-widget>` from the altcha
// package (extends `React.JSX.IntrinsicElements`). The file itself is a
// runtime stub, so this is free at build time.
import 'altcha/types/react';

import React, { useEffect, useImperativeHandle, useRef } from 'react';

/**
 * React wrapper around the <altcha-widget> custom element shipped by the
 * `altcha` npm package. The widget runs a proof-of-work locally, fetches
 * a challenge from the configured `challengeurl`, and emits a payload via
 * its `statechange` / `verified` events.
 *
 * We keep this isolated from the rest of the auth flows so we can:
 *   - lazily `import('altcha')` on the client only (avoids SSR issues
 *     with the custom-element registration)
 *   - centralise CSS token overrides that match the retro theme
 *   - normalise the event surface into a simple `onVerified(payload)` +
 *     `onReset()` callback pair that the forms can bind to.
 */

// The widget element is created by `altcha`; these are the fields we read.
interface AltchaCustomElement extends HTMLElement {
  reset: () => void;
}

// Shape of the `statechange` event detail at runtime. Not exported by the
// `altcha` types directly, so we declare the subset we use.
type StateChangeDetail = {
  state: 'unverified' | 'verifying' | 'verified' | 'error' | 'expired' | 'code';
  payload?: string;
};

/**
 * Public, imperative surface forms use to invalidate the widget after a
 * failed submit. The altcha payload is single-use on the server — once
 * the server rejects it we must flip the widget back to `unverified` so
 * the user can produce a fresh one, otherwise the widget stays silently
 * in `verified` and forms hang with a disabled submit button.
 */
export interface AltchaHandle {
  reset: () => void;
}

interface Props {
  /**
   * Invoked once the widget finishes its PoW and produces a payload. The
   * payload string is what the API's `altcha` field expects.
   */
  onVerified: (payload: string) => void;
  /**
   * Invoked when the widget transitions out of the verified state (expiry,
   * user clicks reset, server verification failed, etc.). Forms should
   * clear any cached payload they hold.
   */
  onReset?: () => void;
  /**
   * Absolute or relative URL returning an ALTCHA challenge JSON. Defaults
   * to `${NEXT_PUBLIC_API_URL}/auth/challenge`, matching the Fastify route
   * registered by the api.
   */
  challengeUrl?: string;
  className?: string;
  /**
   * Imperative handle. Call `handle.reset()` after a failed submit to
   * invalidate the widget's cached proof and make the user re-verify.
   */
  handleRef?: React.Ref<AltchaHandle>;
}

function defaultChallengeUrl(): string {
  const base =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '')
      : undefined;
  return `${base || 'http://localhost:8000'}/auth/challenge`;
}

export const AltchaWidget: React.FC<Props> = ({
  onVerified,
  onReset,
  challengeUrl,
  className,
  handleRef,
}) => {
  const ref = useRef<AltchaCustomElement | null>(null);

  // Expose a stable `reset()` to parents. We call through to the
  // widget's own `reset()` (defined on the custom element) — it flips
  // internal state to `unverified`, which fires `statechange` below
  // and, in turn, invokes the form's `onReset` to clear cached payload.
  useImperativeHandle(
    handleRef,
    () => ({
      reset: () => {
        ref.current?.reset();
      },
    }),
    [],
  );

  // Lazily import the widget bundle on the client so SSR doesn't try to
  // register a custom element (which would crash since `HTMLElement` is
  // undefined on the server).
  useEffect(() => {
    let cancelled = false;
    // altcha registers `<altcha-widget>` as a side effect of being imported.
    import('altcha')
      .then(() => {
        if (cancelled) return;
      })
      .catch(() => {
        // Surface via onReset so forms know the widget isn't functional.
        onReset?.();
      });
    return () => {
      cancelled = true;
    };
  }, [onReset]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleStateChange = (ev: Event) => {
      const detail = (ev as CustomEvent<StateChangeDetail>).detail;
      if (!detail) return;
      if (detail.state === 'verified' && detail.payload) {
        onVerified(detail.payload);
      } else if (
        detail.state === 'unverified' ||
        detail.state === 'expired' ||
        detail.state === 'error'
      ) {
        onReset?.();
      }
    };

    el.addEventListener('statechange', handleStateChange);
    return () => {
      el.removeEventListener('statechange', handleStateChange);
    };
  }, [onVerified, onReset]);

  const url = challengeUrl ?? defaultChallengeUrl();

  return (
    <div className={className}>
      {/*
        The `challenge` attribute accepts either an inline JSON challenge
        or a URL — when a URL is supplied the widget fetches and solves
        it on demand. We use the URL form so a fresh challenge is issued
        per interaction rather than baked into the page.
      */}
      <altcha-widget
        ref={ref as React.RefObject<HTMLElement>}
        name="altcha"
        challenge={url}
        auto="onfocus"
      />
    </div>
  );
};
