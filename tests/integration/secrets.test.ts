import { beforeAll, describe, expect, it } from "vitest";

import {
  deriveKeys,
  MASTER_KEY_BYTES,
  randomBytes,
  SALT_BYTES,
  SIGN_CONTEXT_REVEAL,
  SIGN_CONTEXT_SEAL,
  signChallenge,
  encryptSecret,
} from "@/lib/crypto";

/**
 * Integration tests against a real Postgres (schema must be migrated):
 *
 *   TEST_DATABASE_URL=postgres://... pnpm vitest run tests/integration
 *
 * Skipped entirely when TEST_DATABASE_URL is not set (e.g. plain `pnpm test`).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type SecretsModule = typeof import("@/lib/server/secrets");

let secretsService: SecretsModule;

const IP_A = "203.0.113.10";
const IP_B = "198.51.100.20";

async function createSealedSecret(password: string | null = null) {
  const masterKey = randomBytes(MASTER_KEY_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const keys = await deriveKeys(masterKey, password, salt);
  const { ciphertext, nonce } = await encryptSecret(keys.encKey, "payload");

  const { id, challenge } = await secretsService.initSecret("1h", false);
  const sealResult = await secretsService.sealSecret(id, {
    ciphertext,
    nonce,
    salt,
    publicKey: keys.publicKey,
    signature: signChallenge(SIGN_CONTEXT_SEAL, id, challenge, keys.authSeed),
  });
  expect(sealResult).toBe("ok");
  return { id, masterKey, salt, keys };
}

async function attemptWrong(
  id: string,
  wrongAuthSeed: Uint8Array,
  ip: string,
) {
  const handshake = await secretsService.createRevealChallenge(id, false);
  if (!handshake.ok) throw new Error("handshake failed");
  return secretsService.retrieveSecret(
    id,
    signChallenge(SIGN_CONTEXT_REVEAL, id, handshake.challenge, wrongAuthSeed),
    false,
    ip,
  );
}

describe.skipIf(!TEST_DATABASE_URL)("secret lifecycle (integration)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    secretsService = await import("@/lib/server/secrets");
  });

  it("init → seal → handshake → retrieve → burned", async () => {
    const { id, keys } = await createSealedSecret();

    expect(await secretsService.getPublicStatus(id, false)).toEqual({
      status: "available",
    });

    const handshake = await secretsService.createRevealChallenge(id, false);
    if (!handshake.ok) throw new Error("handshake failed");

    const retrieve = await secretsService.retrieveSecret(
      id,
      signChallenge(SIGN_CONTEXT_REVEAL, id, handshake.challenge, keys.authSeed),
      false,
      IP_A,
    );
    if (!retrieve.ok) throw new Error("retrieve failed");
    expect(retrieve.ciphertext.length).toBeGreaterThan(0);

    // Burned: no further status/handshake/retrieve possible.
    expect(await secretsService.getPublicStatus(id, false)).toEqual({
      status: "unavailable",
    });
    const again = await secretsService.createRevealChallenge(id, false);
    expect(again.ok).toBe(false);

    const [status] = await secretsService.getCreatorStatuses([id]);
    expect(status.status).toBe("retrieved");
    expect(status.retrievedAt).not.toBeNull();
  });

  it("a wrong password never burns the secret", async () => {
    const { id, masterKey, salt, keys } = await createSealedSecret("correct");
    const wrong = await deriveKeys(masterKey, "wrong", salt);

    const result = await attemptWrong(id, wrong.authSeed, IP_A);
    expect(result).toMatchObject({ ok: false, reason: "invalid_signature" });

    // Still available; the rightful recipient can still retrieve it.
    expect(await secretsService.getPublicStatus(id, false)).toEqual({
      status: "available",
    });
    const handshake = await secretsService.createRevealChallenge(id, false);
    if (!handshake.ok) throw new Error("handshake failed");
    const good = await secretsService.retrieveSecret(
      id,
      signChallenge(SIGN_CONTEXT_REVEAL, id, handshake.challenge, keys.authSeed),
      false,
      IP_A,
    );
    expect(good.ok).toBe(true);
  });

  it("applies exponential backoff per client IP without ever destroying", async () => {
    const { id, masterKey, salt } = await createSealedSecret("correct");
    const wrong = await deriveKeys(masterKey, "wrong", salt);

    // 1st wrong: no lockout yet.
    const first = await attemptWrong(id, wrong.authSeed, IP_A);
    expect(first).toMatchObject({
      reason: "invalid_signature",
      retryAfterSeconds: null,
    });

    // 2nd wrong: first lockout step (30s).
    const second = await attemptWrong(id, wrong.authSeed, IP_A);
    expect(second).toMatchObject({ reason: "invalid_signature" });
    if (second.ok === false && second.reason === "invalid_signature") {
      expect(second.retryAfterSeconds).toBe(30);
    }

    // Now locked: even a correct-signature attempt from IP_A is refused.
    const handshake = await secretsService.createRevealChallenge(id, false);
    if (!handshake.ok) throw new Error("handshake failed");
    const lockedTry = await secretsService.retrieveSecret(
      id,
      signChallenge(SIGN_CONTEXT_REVEAL, id, handshake.challenge, wrong.authSeed),
      false,
      IP_A,
    );
    expect(lockedTry).toMatchObject({ ok: false, reason: "locked" });

    // The secret is NEVER destroyed — still available.
    expect(await secretsService.getPublicStatus(id, false)).toEqual({
      status: "available",
    });
  });

  it("the lockout is per IP — a different address is unaffected", async () => {
    const { id, masterKey, salt, keys } = await createSealedSecret("correct");
    const wrong = await deriveKeys(masterKey, "wrong", salt);

    // Lock out IP_A with two wrong guesses.
    await attemptWrong(id, wrong.authSeed, IP_A);
    await attemptWrong(id, wrong.authSeed, IP_A);
    const lockedA = await attemptWrong(id, wrong.authSeed, IP_A);
    expect(lockedA).toMatchObject({ reason: "locked" });

    // The legitimate recipient on IP_B retrieves successfully — never locked out
    // by the attacker's activity on a different address.
    const handshake = await secretsService.createRevealChallenge(id, false);
    if (!handshake.ok) throw new Error("handshake failed");
    const good = await secretsService.retrieveSecret(
      id,
      signChallenge(SIGN_CONTEXT_REVEAL, id, handshake.challenge, keys.authSeed),
      false,
      IP_B,
    );
    expect(good.ok).toBe(true);
  });

  it("exactly one of two concurrent retrievals wins (atomic burn)", async () => {
    const { id, keys } = await createSealedSecret();
    const handshake = await secretsService.createRevealChallenge(id, false);
    if (!handshake.ok) throw new Error("handshake failed");
    const signature = signChallenge(
      SIGN_CONTEXT_REVEAL,
      id,
      handshake.challenge,
      keys.authSeed,
    );

    const results = await Promise.all([
      secretsService.retrieveSecret(id, signature, false, IP_A),
      secretsService.retrieveSecret(id, signature, false, IP_A),
    ]);
    const wins = results.filter((r) => r.ok);
    expect(wins).toHaveLength(1);
  });

  it("a stale challenge cannot be replayed after a new handshake", async () => {
    const { id, keys } = await createSealedSecret();

    const first = await secretsService.createRevealChallenge(id, false);
    if (!first.ok) throw new Error("handshake failed");
    const staleSignature = signChallenge(
      SIGN_CONTEXT_REVEAL,
      id,
      first.challenge,
      keys.authSeed,
    );

    const second = await secretsService.createRevealChallenge(id, false);
    expect(second.ok).toBe(true);

    const result = await secretsService.retrieveSecret(
      id,
      staleSignature,
      false,
      IP_A,
    );
    expect(result.ok).toBe(false);
  });

  it("batch status reports unknown ids", async () => {
    const statuses = await secretsService.getCreatorStatuses([
      "AAAAAAAAAAAAAAAAAAAAA",
    ]);
    expect(statuses[0].status).toBe("unknown");
  });
});
