import { ed25519 } from "@noble/curves/ed25519.js";
import { argon2id } from "hash-wasm";

/**
 * The 1xsecret/v1 cryptographic scheme, self-contained so this package can be
 * MIT-licensed and used anywhere. It is byte-for-byte compatible with the
 * 1xSecret web app: a secret sealed here can be revealed in the browser and
 * vice versa. If the app's scheme ever changes, it gets a new version tag and
 * this file must be updated in lock-step.
 *
 * Runtime requirements: WebCrypto (`globalThis.crypto.subtle`) and
 * `crypto.getRandomValues` — available in Node >= 20, modern browsers, and
 * edge runtimes.
 */

const SCHEME_VERSION = "v1";
const AAD_LABEL = "1xsecret/v1";
const HKDF_INFO_ENC = "1xsecret/v1/enc";
const HKDF_INFO_AUTH = "1xsecret/v1/auth";
export const SIGN_CONTEXT_SEAL = "1xsecret/v1/seal";
export const SIGN_CONTEXT_REVEAL = "1xsecret/v1/reveal";

export const MASTER_KEY_BYTES = 32;
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;

// Argon2id — OWASP baseline (m=19456 KiB, t=2, p=1). Only used with a password.
const ARGON2_MEMORY_KIB = 19456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_OUTPUT_BYTES = 32;

export const MAX_SECRET_LENGTH = 500;

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  if (!BASE64URL_RE.test(value)) throw new Error("Invalid base64url input");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export interface DerivedKeys {
  encKey: CryptoKey;
  authSeed: Uint8Array;
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

export async function encryptSecret(
  encKey: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
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

export function signChallenge(
  context: string,
  secretId: string,
  challengeBase64Url: string,
  authSeed: Uint8Array,
): Uint8Array {
  return ed25519.sign(
    utf8Encode(`${context}:${secretId}:${challengeBase64Url}`),
    authSeed,
  );
}

/** URL fragment format: `v1.<base64url(masterKey)>[.pw]`. */
export function encodeFragment(
  masterKey: Uint8Array,
  passwordProtected: boolean,
): string {
  const parts = [SCHEME_VERSION, toBase64Url(masterKey)];
  if (passwordProtected) parts.push("pw");
  return parts.join(".");
}

export interface FragmentData {
  masterKey: Uint8Array;
  passwordProtected: boolean;
}

export function decodeFragment(fragment: string): FragmentData | null {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const parts = raw.split(".");
  if (parts.length < 2 || parts.length > 3 || parts[0] !== SCHEME_VERSION) {
    return null;
  }
  if (parts.length === 3 && parts[2] !== "pw") return null;
  let masterKey: Uint8Array;
  try {
    masterKey = fromBase64Url(parts[1]!);
  } catch {
    return null;
  }
  if (masterKey.length !== MASTER_KEY_BYTES) return null;
  return { masterKey, passwordProtected: parts.length === 3 };
}
