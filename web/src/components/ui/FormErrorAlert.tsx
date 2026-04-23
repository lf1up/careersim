import React from 'react';

import { RetroAlert } from './RetroBadge';
import { ApiError, isRateLimitError, rateLimitRetryAfterSeconds } from '@/lib/api';

export interface FormErrorAlertProps {
  /**
   * The caught error (or a plain string). When null/undefined the
   * component renders nothing so forms can render it unconditionally.
   */
  error: unknown;
  /**
   * Title used for generic / unknown errors. Rate-limit and
   * `ApiError`s with a known code override this to surface intent
   * (e.g. "Too many requests").
   */
  fallbackTitle?: string;
  /**
   * Title used for the 429 variant. Defaults to "Too many requests"
   * which fits the auth brute-force framing; callers whose endpoint
   * represents a *quota* (e.g. session creation) can pass something
   * more specific like "Session limit reached".
   */
  rateLimitTitle?: string;
  /**
   * Body for the 429 variant. Defaults to the auth-flavoured
   * "slow down … brute-force" copy. Quota endpoints should supply
   * their own explanation — the `waitHint` already carries the
   * human-readable retry-after window so callers can slot it into
   * whatever sentence reads right.
   */
  rateLimitMessage?: (waitHint: string) => React.ReactNode;
  className?: string;
}

/**
 * Thin wrapper around {@link RetroAlert} that understands our {@link
 * ApiError} envelope. Used by every auth form so the UX for 429
 * (`RATE_LIMITED`) is consistent: a warning-toned alert whose body
 * surfaces the server-provided `retryAfter` window without the form
 * needing to do the formatting itself.
 */
export const FormErrorAlert: React.FC<FormErrorAlertProps> = ({
  error,
  fallbackTitle = 'Something went wrong',
  rateLimitTitle = 'Too many requests',
  rateLimitMessage,
  className,
}) => {
  if (error == null) return null;

  if (isRateLimitError(error)) {
    const seconds = rateLimitRetryAfterSeconds(error);
    const waitHint = seconds
      ? formatRetryWindow(seconds)
      : 'in a little while';
    const body = rateLimitMessage ? (
      rateLimitMessage(waitHint)
    ) : (
      <>
        You&apos;re hitting our rate limit — slow down and try again {waitHint}.
        This protects accounts from brute-force attempts.
      </>
    );
    return (
      <RetroAlert tone="warning" title={rateLimitTitle} className={className}>
        {body}
      </RetroAlert>
    );
  }

  // Surface the server-provided message when available, otherwise fall
  // back to the caller-supplied title + a generic string.
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallbackTitle;
  const title =
    error instanceof ApiError && error.code && error.code !== 'RATE_LIMITED'
      ? fallbackTitle
      : fallbackTitle;

  return (
    <RetroAlert tone="error" title={title} className={className}>
      {message}
    </RetroAlert>
  );
};

/**
 * Render "in about 45s" / "in about 2 minutes" / "in about 6 hours" for
 * the retry hint. We round aggressively because the retry-after window
 * is already approximate (bucket TTL), and a "5 hours 59 minutes"
 * message reads worse than a rounded "about 6 hours".
 */
function formatRetryWindow(seconds: number): string {
  if (seconds < 60) return `in about ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? 'in about a minute' : `in about ${minutes} minutes`;
  }
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
}
