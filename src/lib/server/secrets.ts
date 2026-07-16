import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  CHALLENGE_BYTES,
  SIGN_CONTEXT_REVEAL,
  SIGN_CONTEXT_SEAL,
  fromBase64Url,
  randomBytes,
  toBase64Url,
  verifyChallengeSignature,
} from "@/lib/crypto";
import { EXPIRES_IN_MS, getConfig, type ExpiresIn } from "./config";
import { getDb } from "./db";
import { secrets } from "./db/schema";
import { hashIp } from "./ip-hash";
import {
  checkLockout,
  clearAttempts,
  recordFailure,
} from "./retrieval-throttle";

/**
 * Secret lifecycle. All state transitions are guarded by conditional writes so
 * they stay correct under concurrent requests and multiple app replicas.
 *
 * A wrong retrieval password can NEVER destroy a secret: guessing is deterred
 * by a per-(secret, client-IP) exponential backoff (see retrieval-throttle.ts),
 * so a legitimate recipient always keeps their one view.
 */

const SEAL_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const REVEAL_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const STALE_PENDING_MAX_AGE_MS = 60 * 60 * 1000;

export type CreatorStatus =
  | "pending"
  | "retrieved"
  | "expired"
  | "unknown";

export interface SecretStatusEntry {
  id: string;
  status: CreatorStatus;
  retrievedAt: string | null;
  expiresAt: string | null;
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function initSecret(
  expiresIn: ExpiresIn,
  createdFromSafe: boolean,
): Promise<{ id: string; challenge: string }> {
  const db = getDb();
  const id = nanoid();
  const challenge = randomBytes(CHALLENGE_BYTES);
  const now = Date.now();

  await db.$primary.insert(secrets).values({
    id,
    state: "pending",
    challenge: toBuffer(challenge),
    challengeExpiresAt: new Date(now + SEAL_CHALLENGE_TTL_MS),
    createdFromSafe,
    expiresIn,
    expiresAt: new Date(now + EXPIRES_IN_MS[expiresIn]),
  });

  return { id, challenge: toBase64Url(challenge) };
}

export interface SealInput {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  salt: Uint8Array;
  publicKey: Uint8Array;
  signature: Uint8Array;
}

export type SealResult = "ok" | "unavailable" | "invalid_signature";

export async function sealSecret(
  id: string,
  input: SealInput,
): Promise<SealResult> {
  const db = getDb();
  const [row] = await db.$primary
    .select({
      state: secrets.state,
      challenge: secrets.challenge,
      challengeExpiresAt: secrets.challengeExpiresAt,
      expiresAt: secrets.expiresAt,
    })
    .from(secrets)
    .where(eq(secrets.id, id));

  const now = new Date();
  if (
    !row ||
    row.state !== "pending" ||
    !row.challenge ||
    !row.challengeExpiresAt ||
    row.challengeExpiresAt <= now ||
    row.expiresAt <= now
  ) {
    return "unavailable";
  }

  const challengeB64u = toBase64Url(row.challenge);
  if (
    !verifyChallengeSignature(
      SIGN_CONTEXT_SEAL,
      id,
      challengeB64u,
      input.signature,
      input.publicKey,
    )
  ) {
    return "invalid_signature";
  }

  // Conditional on the same challenge we verified — a concurrent transition
  // (or expiry sweep) makes this a no-op instead of a corrupt state.
  const updated = await db.$primary
    .update(secrets)
    .set({
      state: "sealed",
      ciphertext: toBuffer(input.ciphertext),
      nonce: toBuffer(input.nonce),
      salt: toBuffer(input.salt),
      publicKey: toBuffer(input.publicKey),
      challenge: null,
      challengeExpiresAt: null,
      sealedAt: now,
    })
    .where(
      and(
        eq(secrets.id, id),
        eq(secrets.state, "pending"),
        eq(secrets.challenge, row.challenge),
      ),
    )
    .returning({ id: secrets.id });

  return updated.length === 1 ? "ok" : "unavailable";
}

export type RevealAccess = "ok" | "restricted" | "unavailable";

interface AccessCheckRow {
  state: string;
  expiresAt: Date;
  createdFromSafe: boolean;
}

function checkAccess(
  row: AccessCheckRow | undefined,
  clientIsSafe: boolean,
): RevealAccess {
  if (!row || row.state !== "sealed" || row.expiresAt <= new Date()) {
    return "unavailable";
  }
  const config = getConfig();
  if (
    config.accessMode === "SAFEGUARDED" &&
    !row.createdFromSafe &&
    !clientIsSafe
  ) {
    return "restricted";
  }
  return "ok";
}

export async function getPublicStatus(
  id: string,
  clientIsSafe: boolean,
): Promise<{ status: "available" | "restricted" | "unavailable" }> {
  const db = getDb();
  const [row] = await db.$primary
    .select({
      state: secrets.state,
      expiresAt: secrets.expiresAt,
      createdFromSafe: secrets.createdFromSafe,
    })
    .from(secrets)
    .where(eq(secrets.id, id));

  const access = checkAccess(row, clientIsSafe);
  if (access === "ok") return { status: "available" };
  if (access === "restricted") return { status: "restricted" };
  return { status: "unavailable" };
}

export type HandshakeResult =
  | { ok: true; salt: string; challenge: string }
  | { ok: false; reason: "restricted" | "unavailable" };

export async function createRevealChallenge(
  id: string,
  clientIsSafe: boolean,
): Promise<HandshakeResult> {
  const db = getDb();
  const [row] = await db.$primary
    .select({
      state: secrets.state,
      expiresAt: secrets.expiresAt,
      createdFromSafe: secrets.createdFromSafe,
      salt: secrets.salt,
    })
    .from(secrets)
    .where(eq(secrets.id, id));

  const access = checkAccess(row, clientIsSafe);
  if (access !== "ok") {
    return { ok: false, reason: access === "restricted" ? "restricted" : "unavailable" };
  }
  if (!row?.salt) {
    return { ok: false, reason: "unavailable" };
  }

  const challenge = randomBytes(CHALLENGE_BYTES);
  const updated = await db.$primary
    .update(secrets)
    .set({
      challenge: toBuffer(challenge),
      challengeExpiresAt: new Date(Date.now() + REVEAL_CHALLENGE_TTL_MS),
    })
    .where(and(eq(secrets.id, id), eq(secrets.state, "sealed")))
    .returning({ id: secrets.id });

  if (updated.length !== 1) {
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    salt: toBase64Url(row.salt),
    challenge: toBase64Url(challenge),
  };
}

export type RetrieveResult =
  | { ok: true; ciphertext: string; nonce: string }
  | { ok: false; reason: "restricted" | "unavailable" }
  | { ok: false; reason: "invalid_signature"; retryAfterSeconds: number | null }
  | { ok: false; reason: "locked"; retryAfterSeconds: number };

export async function retrieveSecret(
  id: string,
  signature: Uint8Array,
  clientIsSafe: boolean,
  clientIp: string,
): Promise<RetrieveResult> {
  const db = getDb();
  const [row] = await db.$primary
    .select({
      state: secrets.state,
      expiresAt: secrets.expiresAt,
      createdFromSafe: secrets.createdFromSafe,
      challenge: secrets.challenge,
      challengeExpiresAt: secrets.challengeExpiresAt,
      publicKey: secrets.publicKey,
    })
    .from(secrets)
    .where(eq(secrets.id, id));

  const access = checkAccess(row, clientIsSafe);
  if (access !== "ok") {
    return { ok: false, reason: access === "restricted" ? "restricted" : "unavailable" };
  }

  const now = new Date();
  if (
    !row?.challenge ||
    !row.challengeExpiresAt ||
    row.challengeExpiresAt <= now ||
    !row.publicKey
  ) {
    return { ok: false, reason: "unavailable" };
  }

  // Backoff gate: a locked (secret, client-IP) pair may not even attempt a
  // guess until the lockout elapses. The secret itself is never touched, so
  // this only delays — it can never destroy the secret or lock out the
  // legitimate recipient (who retrieves from a different address).
  const ipHash = hashIp(clientIp);
  const lockout = await checkLockout(id, ipHash);
  if (lockout.locked) {
    return { ok: false, reason: "locked", retryAfterSeconds: lockout.retryAfterSeconds };
  }

  const challengeB64u = toBase64Url(row.challenge);
  if (
    !verifyChallengeSignature(
      SIGN_CONTEXT_REVEAL,
      id,
      challengeB64u,
      signature,
      row.publicKey,
    )
  ) {
    const { retryAfterSeconds } = await recordFailure(id, ipHash);
    return { ok: false, reason: "invalid_signature", retryAfterSeconds };
  }

  // Atomic burn. The inner SELECT ... FOR UPDATE serializes concurrent
  // retrievers; the re-checked predicates guarantee only one of them receives
  // the ciphertext. RETURNING reads from the locked pre-update row alias, so
  // the caller gets the OLD (non-null) payload.
  const burned = await db.$primary.execute<{
    ciphertext: Buffer;
    nonce: Buffer;
  }>(sql`
    UPDATE ${secrets} s
    SET ciphertext = NULL,
        nonce = NULL,
        salt = NULL,
        public_key = NULL,
        challenge = NULL,
        challenge_expires_at = NULL,
        state = 'retrieved',
        retrieved_at = now()
    FROM (
      SELECT id, ciphertext, nonce
      FROM ${secrets}
      WHERE id = ${id}
        AND state = 'sealed'
        AND challenge = ${toBuffer(fromBase64Url(challengeB64u))}
        AND challenge_expires_at > now()
        AND expires_at > now()
      FOR UPDATE
    ) old
    WHERE s.id = old.id
    RETURNING old.ciphertext AS ciphertext, old.nonce AS nonce
  `);

  const burnedRow = burned.rows[0];
  if (!burnedRow?.ciphertext || !burnedRow.nonce) {
    return { ok: false, reason: "unavailable" };
  }

  // Successful view clears the throttle for this secret.
  await clearAttempts(id).catch(() => {});

  return {
    ok: true,
    ciphertext: toBase64Url(burnedRow.ciphertext),
    nonce: toBase64Url(burnedRow.nonce),
  };
}

const STATUS_BATCH_LIMIT = 100;

export async function getCreatorStatuses(
  ids: string[],
): Promise<SecretStatusEntry[]> {
  const db = getDb();
  const unique = [...new Set(ids)].slice(0, STATUS_BATCH_LIMIT);
  if (unique.length === 0) return [];

  // Replica read is fine here: the creator's history tolerates a few seconds
  // of lag, and the reveal path never depends on it.
  const rows = await db
    .select({
      id: secrets.id,
      state: secrets.state,
      retrievedAt: secrets.retrievedAt,
      expiresAt: secrets.expiresAt,
    })
    .from(secrets)
    .where(inArray(secrets.id, unique));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const now = new Date();

  return unique.map((id) => {
    const row = byId.get(id);
    if (!row) {
      return { id, status: "unknown", retrievedAt: null, expiresAt: null };
    }
    let status: CreatorStatus;
    switch (row.state) {
      case "retrieved":
        status = "retrieved";
        break;
      case "sealed":
        status = row.expiresAt <= now ? "expired" : "pending";
        break;
      default:
        status = row.expiresAt <= now ? "expired" : "unknown";
    }
    return {
      id,
      status,
      retrievedAt: row.retrievedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
    };
  });
}

/**
 * Garbage collection (instrumentation.ts runs this every 10 minutes under an
 * advisory lock). NOT a security boundary — every read predicate re-checks
 * expiry on its own.
 */
export async function sweepSecrets(): Promise<void> {
  const db = getDb();
  const config = getConfig();

  // 1. Expired but still holding a payload: destroy the ciphertext, keep the
  //    receipt row so the creator sees "expired".
  await db.$primary.execute(sql`
    UPDATE ${secrets}
    SET ciphertext = NULL, nonce = NULL, salt = NULL, public_key = NULL,
        challenge = NULL, challenge_expires_at = NULL
    WHERE expires_at <= now() AND ciphertext IS NOT NULL
  `);

  // 2. Stale pending rows (init without seal) have no receipt value.
  await db.$primary.execute(sql`
    DELETE FROM ${secrets}
    WHERE state = 'pending'
      AND created_at <= now() - make_interval(secs => ${STALE_PENDING_MAX_AGE_MS / 1000})
  `);

  // 3. Receipt rows past retention.
  await db.$primary.execute(sql`
    DELETE FROM ${secrets}
    WHERE coalesce(retrieved_at, expires_at)
          <= now() - make_interval(days => ${config.retentionDays})
  `);
}
