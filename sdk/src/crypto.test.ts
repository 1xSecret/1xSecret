import { describe, expect, it } from "vitest";

import {
  decodeFragment,
  decryptSecret,
  deriveKeys,
  encodeFragment,
  encryptSecret,
  fromBase64Url,
  MASTER_KEY_BYTES,
  randomBytes,
  SALT_BYTES,
  SIGN_CONTEXT_REVEAL,
  signChallenge,
  toBase64Url,
} from "./crypto.js";
import { ed25519 } from "@noble/curves/ed25519.js";

describe("SDK crypto (1xsecret/v1 compatibility)", () => {
  it("round-trips a secret with a password", async () => {
    const masterKey = randomBytes(MASTER_KEY_BYTES);
    const salt = randomBytes(SALT_BYTES);
    const keys = await deriveKeys(masterKey, "hunter2", salt);
    const { ciphertext, nonce } = await encryptSecret(keys.encKey, "s3cr3t 🤫");

    // Re-derive from scratch (as the reveal path does) and decrypt.
    const reKeys = await deriveKeys(masterKey, "hunter2", salt);
    await expect(
      decryptSecret(reKeys.encKey, ciphertext, nonce),
    ).resolves.toBe("s3cr3t 🤫");
  });

  it("a wrong password fails to decrypt", async () => {
    const masterKey = randomBytes(MASTER_KEY_BYTES);
    const salt = randomBytes(SALT_BYTES);
    const right = await deriveKeys(masterKey, "correct", salt);
    const wrong = await deriveKeys(masterKey, "wrong", salt);
    const { ciphertext, nonce } = await encryptSecret(right.encKey, "x");
    await expect(
      decryptSecret(wrong.encKey, ciphertext, nonce),
    ).rejects.toThrow();
  });

  it("derives a verifiable Ed25519 signature over the challenge", async () => {
    const masterKey = randomBytes(MASTER_KEY_BYTES);
    const salt = randomBytes(SALT_BYTES);
    const keys = await deriveKeys(masterKey, null, salt);
    const challenge = toBase64Url(randomBytes(32));
    const sig = signChallenge(SIGN_CONTEXT_REVEAL, "id123", challenge, keys.authSeed);
    const msg = new TextEncoder().encode(
      `${SIGN_CONTEXT_REVEAL}:id123:${challenge}`,
    );
    expect(ed25519.verify(sig, msg, keys.publicKey)).toBe(true);
  });

  it("encodes and decodes the URL fragment", () => {
    const masterKey = randomBytes(MASTER_KEY_BYTES);
    const withPw = encodeFragment(masterKey, true);
    expect(withPw).toMatch(/^v1\.[A-Za-z0-9_-]{43}\.pw$/);
    const decoded = decodeFragment(`#${withPw}`);
    expect(decoded?.masterKey).toEqual(masterKey);
    expect(decoded?.passwordProtected).toBe(true);
  });

  it("base64url round-trips", () => {
    const bytes = randomBytes(40);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});
