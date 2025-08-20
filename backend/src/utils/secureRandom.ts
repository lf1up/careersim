import crypto from 'crypto';

/**
 * Returns a cryptographically secure random float in [0, 1).
 */
export function randomFloat(): number {
  // Use 53 bits to match JS number mantissa precision
  const max = Math.pow(2, 53);
  const n = crypto.randomInt(0, max);
  return n / max;
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

