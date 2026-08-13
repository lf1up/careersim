export function parseCorsAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * The empty-allowlist policy is explicit: callers pass `allowAllWhenEmpty`
 * (true in dev/test, false in production) so a missing
 * `CORS_ALLOWED_ORIGINS` can never silently open a production deployment.
 */
export function isCorsOriginAllowed(
  origin: string,
  allowedOrigins: readonly string[],
  allowAllWhenEmpty: boolean,
): boolean {
  if (allowedOrigins.length === 0) return allowAllWhenEmpty;
  return allowedOrigins.includes(origin);
}
