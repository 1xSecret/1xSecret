import { ed25519 } from "@noble/curves/ed25519.js";
import { argon2id } from "hash-wasm";

import {
  AAD_LABEL,
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_OUTPUT_BYTES,
  ARGON2_PARALLELISM,
  HKDF_INFO_AUTH,
  HKDF_INFO_ENC,
  NONCE_BYTES,
} from "./constants";
import { concatBytes, randomBytes, utf8Decode, utf8Encode } from "./encoding";

/**
 * Isomorphic crypto core (browser + Node >= 20). The scheme (each secret has
 * its own freshly random masterKey and salt):
 *
 *   ikm      = concat(masterKey, Argon2id(password, salt))  (password part omitted if unset)
 *   encKey   = HKDF-SHA256(ikm, salt, "1xsecret/v1/enc")   -> AES-256-GCM
 *   authSeed = HKDF-SHA256(ikm, salt, "1xsecret/v1/auth")  -> Ed25519 seed
 *
 * encKey and authSeed are computationally independent: the server, which learns
 * the Ed25519 public key and signatures, gains nothing towards decryption.
 * Folding the password into the same IKM makes it cryptographically required
 * for BOTH retrieval (signature) and decryption — a wrong password produces an
 * invalid signature, which the server rejects without burning the secret.
 */

export interface DerivedKeys {
  /** AES-256-GCM key; non-extractable, key bytes never materialize in JS. */
  encKey: CryptoKey;
  /** Deterministic Ed25519 seed (32 bytes). */
  authSeed: Uint8Array;
  /** Ed25519 public key (32 bytes) — stored server-side at seal time. */
  publicKey: Uint8Array;
}

async function stretchPassword(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return argon2id({
    password: password.normalize("NFC"),
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: ARGON2_OUTPUT_BYTES,
    outputType: "binary",
  });
}

export async function deriveKeys(
  masterKey: Uint8Array,
  password: string | null,
  salt: Uint8Array,
): Promise<DerivedKeys> {
  // Argon2id only runs for real passwords; the random 256-bit master key needs
  // no stretching and must not be slowed down by a KDF over a constant.
  const ikm =
    password && password.length > 0
      ? concatBytes(masterKey, await stretchPassword(password, salt))
      : masterKey;

  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveKey", "deriveBits"],
  );

  const encKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: utf8Encode(HKDF_INFO_ENC) as BufferSource,
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const authSeedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: utf8Encode(HKDF_INFO_AUTH) as BufferSource,
    },
    hkdfKey,
    256,
  );
  const authSeed = new Uint8Array(authSeedBits);

  return { encKey, authSeed, publicKey: ed25519.getPublicKey(authSeed) };
}

export interface EncryptedSecret {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export async function encryptSecret(
  encKey: CryptoKey,
  plaintext: string,
): Promise<EncryptedSecret> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce as BufferSource,
      additionalData: utf8Encode(AAD_LABEL) as BufferSource,
    },
    encKey,
    utf8Encode(plaintext) as BufferSource,
  );
  return { ciphertext: new Uint8Array(ciphertext), nonce };
}

export async function decryptSecret(
  encKey: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce as BufferSource,
      additionalData: utf8Encode(AAD_LABEL) as BufferSource,
    },
    encKey,
    ciphertext as BufferSource,
  );
  return utf8Decode(new Uint8Array(plaintext));
}

/**
 * The signed message binds purpose, secret id and server challenge so a
 * signature can never be replayed for another secret, another challenge or
 * another operation (seal vs. reveal).
 */
export function buildSignatureMessage(
  context: string,
  secretId: string,
  challengeBase64Url: string,
): Uint8Array {
  return utf8Encode(`${context}:${secretId}:${challengeBase64Url}`);
}

export function signChallenge(
  context: string,
  secretId: string,
  challengeBase64Url: string,
  authSeed: Uint8Array,
): Uint8Array {
  return ed25519.sign(
    buildSignatureMessage(context, secretId, challengeBase64Url),
    authSeed,
  );
}

export function verifyChallengeSignature(
  context: string,
  secretId: string,
  challengeBase64Url: string,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(
      signature,
      buildSignatureMessage(context, secretId, challengeBase64Url),
      publicKey,
    );
  } catch {
    // Malformed signatures/keys (wrong length, invalid point) count as invalid.
    return false;
  }
}
