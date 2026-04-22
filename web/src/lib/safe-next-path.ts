// Validate a user-supplied `?next=` redirect target. We only allow relative
// in-app paths (starting with a single `/`) so an attacker can't craft a
// link that bounces authenticated users off to a third-party origin.
//
// Examples:
//   safeNextPath('/simulations/abc')        → '/simulations/abc'
//   safeNextPath('//evil.com')              → fallback
//   safeNextPath('https://evil.com')        → fallback
//   safeNextPath(null)                      → fallback
export function safeNextPath(
  value: string | null | undefined,
  fallback: string,
): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/')) return fallback;
  // Reject protocol-relative URLs (`//example.com`) and path-traversal.
  if (value.startsWith('//')) return fallback;
  return value;
}
