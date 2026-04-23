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
  className,
}) => {
  if (error == null) return null;

  if (isRateLimitError(error)) {
    const seconds = rateLimitRetryAfterSeconds(error);
    const waitHint = seconds
      ? formatRetryWindow(seconds)
      : 'Please wait a moment before retrying.';
    return (
      <RetroAlert tone="warning" title="Too many requests" className={className}>
        You&apos;re hitting our rate limit — slow down and try again {waitHint}.
        This protects accounts from brute-force attempts.
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

/** Render "in 45s" / "in 2 minutes" etc. for the retry hint. */
function formatRetryWindow(seconds: number): string {
  if (seconds < 60) return `in about ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'in about a minute' : `in about ${minutes} minutes`;
}
