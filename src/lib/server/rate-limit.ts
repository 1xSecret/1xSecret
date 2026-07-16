/**
 * In-memory fixed-window rate limiter, per app instance.
 *
 * Cross-instance protection for the sensitive path (signature guessing) lives
 * in the database (failed_attempts counter per secret); this limiter is a
 * cheap first line of defense against request floods. Operators who need
 * stricter global limits should configure them at the reverse proxy.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 100_000;

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      // Drop expired buckets; if memory pressure persists, fail open rather
      // than letting the map grow unbounded.
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
      }
      if (buckets.size >= MAX_BUCKETS) return true;
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limit;
}

export const RATE_LIMITS = {
  init: { limit: 30, windowMs: 60_000 },
  seal: { limit: 30, windowMs: 60_000 },
  handshake: { limit: 30, windowMs: 60_000 },
  retrieve: { limit: 30, windowMs: 60_000 },
  status: { limit: 120, windowMs: 60_000 },
} as const;
