import crypto from 'crypto';

/**
 * Returns a cryptographically secure random float in [0, 1).
 */
export function randomFloat(): number {
  // Use 48 random bits to stay within safe integer boundaries
  // Generate 6 random bytes (0 .. 2^48-1) and normalize to [0,1)
  const buf = crypto.randomBytes(6);
  const n = buf.readUIntBE(0, 6);
  const maxExclusive = Math.pow(2, 48);
  return n / maxExclusive;
}

/**
 * Returns a cryptographically secure random integer in the inclusive range [min, max].
 */
export function randomInt(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new TypeError('randomInt requires finite min and max');
  }
  if (Math.floor(min) !== min || Math.floor(max) !== max) {
    throw new TypeError('randomInt requires integer min and max');
  }
  if (max < min) {
    throw new RangeError('randomInt requires max >= min');
  }
  // crypto.randomInt is [min, max) so add 1 to make inclusive
  return crypto.randomInt(min, max + 1);
}

/**
 * Convenience: secure random delay in milliseconds within [minMs, maxMs] inclusive.
 */
export function randomDelayMs(minMs: number, maxMs: number): number {
  const min = Math.max(0, Math.floor(minMs));
  const max = Math.max(min, Math.floor(maxMs));
  return randomInt(min, max);
}

