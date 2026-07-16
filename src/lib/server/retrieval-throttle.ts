import { and, eq, sql } from "drizzle-orm";

import { getDb } from "./db";
import { retrievalAttempts } from "./db/schema";

/**
 * Exponential backoff for retrieval-password guessing, stored in the database
 * (so it is synchronized across replicas) and keyed by (secret, HMAC of client
 * IP). A wrong password NEVER destroys the secret; it only delays further
 * attempts from the same address.
 *
 * Schedule: a lockout is applied after every `BACKOFF_STEP` failures, doubling
 * each step from `BACKOFF_BASE_SECONDS`, capped at `BACKOFF_MAX_SECONDS`:
 *
 *   fails  2 -> 30s,  4 -> 60s,  6 -> 120s,  8 -> 240s,  10 -> 480s, ... (cap 1h)
 *
 * Between lockout steps a single further attempt is allowed, matching a
 * "two tries then wait" cadence. The counter persists until the secret is
 * retrieved or deleted, so a sustained attacker faces ever-growing delays
 * while a legitimate recipient who eventually succeeds clears it.
 */
export const BACKOFF_STEP = 2;
export const BACKOFF_BASE_SECONDS = 30;
export const BACKOFF_MAX_SECONDS = 3600;

export function lockoutSecondsFor(failCount: number): number | null {
  if (failCount <= 0 || failCount % BACKOFF_STEP !== 0) return null;
  const step = failCount / BACKOFF_STEP; // 1, 2, 3, ...
  return Math.min(
    BACKOFF_BASE_SECONDS * 2 ** (step - 1),
    BACKOFF_MAX_SECONDS,
  );
}

export interface LockoutState {
  locked: boolean;
  retryAfterSeconds: number;
}

/** Non-destructive check of the current lockout for (secret, ipHash). */
export async function checkLockout(
  secretId: string,
  ipHash: string,
): Promise<LockoutState> {
  const db = getDb();
  const [row] = await db.$primary
    .select({ lockedUntil: retrievalAttempts.lockedUntil })
    .from(retrievalAttempts)
    .where(
      and(
        eq(retrievalAttempts.secretId, secretId),
        eq(retrievalAttempts.ipHash, ipHash),
      ),
    );

  if (!row?.lockedUntil) return { locked: false, retryAfterSeconds: 0 };
  const remainingMs = row.lockedUntil.getTime() - Date.now();
  if (remainingMs <= 0) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

/**
 * Record one failed attempt and apply the next lockout step if this failure
 * reaches a multiple of BACKOFF_STEP. Atomic upsert, so concurrent failures
 * from the same address increment consistently.
 */
export async function recordFailure(
  secretId: string,
  ipHash: string,
): Promise<{ retryAfterSeconds: number | null }> {
  const db = getDb();
  const result = await db.$primary.execute<{ fail_count: number }>(sql`
    INSERT INTO ${retrievalAttempts} (secret_id, ip_hash, fail_count, updated_at)
    VALUES (${secretId}, ${ipHash}, 1, now())
    ON CONFLICT (secret_id, ip_hash)
    DO UPDATE SET fail_count = ${retrievalAttempts}.fail_count + 1, updated_at = now()
    RETURNING fail_count
  `);

  const failCount = Number(result.rows[0]?.fail_count ?? 0);
  const lockoutSeconds = lockoutSecondsFor(failCount);
  if (lockoutSeconds === null) {
    return { retryAfterSeconds: null };
  }

  await db.$primary.execute(sql`
    UPDATE ${retrievalAttempts}
    SET locked_until = now() + make_interval(secs => ${lockoutSeconds})
    WHERE secret_id = ${secretId} AND ip_hash = ${ipHash}
  `);
  return { retryAfterSeconds: lockoutSeconds };
}

/** Clear the throttle after a successful retrieval (defensive; the row is also removed by the FK cascade when the secret is deleted). */
export async function clearAttempts(secretId: string): Promise<void> {
  const db = getDb();
  await db.$primary
    .delete(retrievalAttempts)
    .where(eq(retrievalAttempts.secretId, secretId));
}
