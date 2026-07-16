/**
 * Cryptographic scheme constants. Everything is versioned under "1xsecret/v1";
 * changing any parameter requires a new version tag so existing links keep
 * decrypting.
 */

export const SCHEME_VERSION = "v1";

/** Domain-separation label bound into the AES-GCM AAD. */
export const AAD_LABEL = "1xsecret/v1";

/** HKDF info strings — encryption key and signing seed are independent. */
export const HKDF_INFO_ENC = "1xsecret/v1/enc";
export const HKDF_INFO_AUTH = "1xsecret/v1/auth";

/** Signature message prefixes (bind purpose + secret id + challenge). */
export const SIGN_CONTEXT_SEAL = "1xsecret/v1/seal";
export const SIGN_CONTEXT_REVEAL = "1xsecret/v1/reveal";

export const MASTER_KEY_BYTES = 32;
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12; // AES-GCM standard 96-bit nonce
export const CHALLENGE_BYTES = 32;
export const ED25519_PUBLIC_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

/**
 * Argon2id parameters (OWASP Password Storage Cheat Sheet baseline:
 * m=19456 KiB, t=2, p=1). Only used when the creator sets a retrieval password;
 * a high-entropy random master key needs no stretching.
 */
export const ARGON2_MEMORY_KIB = 19456;
export const ARGON2_ITERATIONS = 2;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_OUTPUT_BYTES = 32;

export const MAX_SECRET_LENGTH = 500;

/** Server-side sanity cap for the sealed payload (base64url ciphertext). */
export const MAX_CIPHERTEXT_BYTES = 8192;
