import { describe, expect, it } from "vitest";

import {
  buildSignatureMessage,
  decodeFragment,
  decryptSecret,
  deriveKeys,
  encodeFragment,
  encryptSecret,
  fromBase64Url,
  generatePassword,
  MASTER_KEY_BYTES,
  NONCE_BYTES,
  randomBytes,
  SALT_BYTES,
  SIGN_CONTEXT_REVEAL,
  SIGN_CONTEXT_SEAL,
  signChallenge,
  toBase64Url,
  verifyChallengeSignature,
} from "./index";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    for (const len of [0, 1, 2, 3, 16, 32, 33, 100]) {
      const bytes = randomBytes(len);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it("produces URL-safe output without padding", () => {
    const encoded = toBase64Url(randomBytes(64));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
  });

  it("rejects non-base64url input", () => {
    expect(() => fromBase64Url("abc+/=")).toThrow();
    expect(() => fromBase64Url("hello world")).toThrow();
  });
});

describe("fragment", () => {
  it("round-trips without password flag", () => {
    const masterKey = randomBytes(MASTER_KEY_BYTES);
    const fragment = encodeFragment({ masterKey, passwordProtected: false });
    expect(fragment).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    const decoded = decodeFragment(fragment);
    expect(decoded?.masterKey).toEqual(masterKey);
    expect(decoded?.passwordProtected).toBe(false);
  });

  it("round-trips with password flag and leading #", () => {
    const masterKey = randomBytes(MASTER_KEY_BYTES);
    const fragment = encodeFragment({ masterKey, passwordProtected: true });
    expect(fragment.endsWith(".pw")).toBe(true);
    const decoded = decodeFragment(`#${fragment}`);
    expect(decoded?.masterKey).toEqual(masterKey);
    expect(decoded?.passwordProtected).toBe(true);
  });

  it("rejects malformed fragments", () => {
    expect(decodeFragment("")).toBeNull();
    expect(decodeFragment("v2.AAAA")).toBeNull();
    expect(decodeFragment("v1.notbase64!!")).toBeNull();
    expect(decodeFragment(`v1.${toBase64Url(randomBytes(16))}`)).toBeNull(); // wrong key length
    expect(
      decodeFragment(`v1.${toBase64Url(randomBytes(32))}.xx`),
    ).toBeNull(); // unknown flag
    expect(
      decodeFragment(`v1.${toBase64Url(randomBytes(32))}.pw.extra`),
    ).toBeNull();
  });
});

describe("deriveKeys", () => {
  const masterKey = randomBytes(MASTER_KEY_BYTES);
  const salt = randomBytes(SALT_BYTES);

  it("is deterministic for identical inputs", async () => {
    const a = await deriveKeys(masterKey, null, salt);
    const b = await deriveKeys(masterKey, null, salt);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.authSeed).toEqual(b.authSeed);
  });

  it("password changes both auth and encryption keys", async () => {
    const withoutPw = await deriveKeys(masterKey, null, salt);
    const withPw = await deriveKeys(masterKey, "hunter2", salt);
    expect(withPw.publicKey).not.toEqual(withoutPw.publicKey);

    const { ciphertext, nonce } = await encryptSecret(withPw.encKey, "top");
    await expect(
      decryptSecret(withoutPw.encKey, ciphertext, nonce),
    ).rejects.toThrow();
  });

  it("different passwords yield different keys (crypto-enforced 2nd factor)", async () => {
    const a = await deriveKeys(masterKey, "correct horse", salt);
    const b = await deriveKeys(masterKey, "correct horsf", salt);
    expect(a.publicKey).not.toEqual(b.publicKey);
  });

  it("different salts yield different keys", async () => {
    const a = await deriveKeys(masterKey, "pw", salt);
    const b = await deriveKeys(masterKey, "pw", randomBytes(SALT_BYTES));
    expect(a.publicKey).not.toEqual(b.publicKey);
  });

  it("normalizes unicode passwords (NFC)", async () => {
    // "é" composed vs decomposed must derive the same keys.
    const a = await deriveKeys(masterKey, "café", salt);
    const b = await deriveKeys(masterKey, "café", salt);
    expect(a.publicKey).toEqual(b.publicKey);
  });
});

describe("encrypt/decrypt", () => {
  it("round-trips text incl. umlauts and emoji", async () => {
    const { encKey } = await deriveKeys(
      randomBytes(MASTER_KEY_BYTES),
      null,
      randomBytes(SALT_BYTES),
    );
    const plaintext = "Geheim! 🤫 ÄÖÜß — client_secret=abc123";
    const { ciphertext, nonce } = await encryptSecret(encKey, plaintext);
    expect(nonce.length).toBe(NONCE_BYTES);
    await expect(decryptSecret(encKey, ciphertext, nonce)).resolves.toBe(
      plaintext,
    );
  });

  it("fails on tampered ciphertext (GCM integrity)", async () => {
    const { encKey } = await deriveKeys(
      randomBytes(MASTER_KEY_BYTES),
      null,
      randomBytes(SALT_BYTES),
    );
    const { ciphertext, nonce } = await encryptSecret(encKey, "payload");
    ciphertext[0] ^= 0xff;
    await expect(decryptSecret(encKey, ciphertext, nonce)).rejects.toThrow();
  });

  it("fails with the wrong key", async () => {
    const salt = randomBytes(SALT_BYTES);
    const right = await deriveKeys(randomBytes(MASTER_KEY_BYTES), null, salt);
    const wrong = await deriveKeys(randomBytes(MASTER_KEY_BYTES), null, salt);
    const { ciphertext, nonce } = await encryptSecret(right.encKey, "payload");
    await expect(
      decryptSecret(wrong.encKey, ciphertext, nonce),
    ).rejects.toThrow();
  });
});

describe("challenge signatures", () => {
  const masterKey = randomBytes(MASTER_KEY_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const secretId = "aBcD1234eFgH5678iJkL9";
  const challenge = toBase64Url(randomBytes(32));

  it("verifies a valid reveal signature", async () => {
    const { authSeed, publicKey } = await deriveKeys(masterKey, "pw", salt);
    const signature = signChallenge(
      SIGN_CONTEXT_REVEAL,
      secretId,
      challenge,
      authSeed,
    );
    expect(
      verifyChallengeSignature(
        SIGN_CONTEXT_REVEAL,
        secretId,
        challenge,
        signature,
        publicKey,
      ),
    ).toBe(true);
  });

  it("rejects a signature made with the wrong password", async () => {
    const sealed = await deriveKeys(masterKey, "correct", salt);
    const attempt = await deriveKeys(masterKey, "wrong", salt);
    const signature = signChallenge(
      SIGN_CONTEXT_REVEAL,
      secretId,
      challenge,
      attempt.authSeed,
    );
    expect(
      verifyChallengeSignature(
        SIGN_CONTEXT_REVEAL,
        secretId,
        challenge,
        signature,
        sealed.publicKey,
      ),
    ).toBe(false);
  });

  it("rejects cross-context, cross-id and cross-challenge replays", async () => {
    const { authSeed, publicKey } = await deriveKeys(masterKey, null, salt);
    const signature = signChallenge(
      SIGN_CONTEXT_SEAL,
      secretId,
      challenge,
      authSeed,
    );
    expect(
      verifyChallengeSignature(
        SIGN_CONTEXT_REVEAL,
        secretId,
        challenge,
        signature,
        publicKey,
      ),
    ).toBe(false);
    expect(
      verifyChallengeSignature(
        SIGN_CONTEXT_SEAL,
        "otherSecretId0000000",
        challenge,
        signature,
        publicKey,
      ),
    ).toBe(false);
    expect(
      verifyChallengeSignature(
        SIGN_CONTEXT_SEAL,
        secretId,
        toBase64Url(randomBytes(32)),
        signature,
        publicKey,
      ),
    ).toBe(false);
  });

  it("treats malformed signatures and keys as invalid instead of throwing", async () => {
    const { publicKey } = await deriveKeys(masterKey, null, salt);
    expect(
      verifyChallengeSignature(
        SIGN_CONTEXT_REVEAL,
        secretId,
        challenge,
        randomBytes(10),
        publicKey,
      ),
    ).toBe(false);
    expect(
      verifyChallengeSignature(
        SIGN_CONTEXT_REVEAL,
        secretId,
        challenge,
        randomBytes(64),
        randomBytes(31),
      ),
    ).toBe(false);
  });

  it("builds an unambiguous signature message", () => {
    const msg = buildSignatureMessage(SIGN_CONTEXT_REVEAL, "id", "chal");
    expect(new TextDecoder().decode(msg)).toBe("1xsecret/v1/reveal:id:chal");
  });
});

describe("generatePassword", () => {
  it("generates passwords of the requested length and alphabet", () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/^[a-km-zA-HJ-NP-Z2-9\-_!?*+#]+$/);
  });

  it("generates distinct passwords", () => {
    expect(new Set([1, 2, 3, 4, 5].map(() => generatePassword())).size).toBe(5);
  });
});
