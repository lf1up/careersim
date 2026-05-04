export function parseCorsAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isCorsOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.length === 0 || allowedOrigins.includes(origin);
}
