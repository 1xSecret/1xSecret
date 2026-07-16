import {
  MASTER_KEY_BYTES,
  SALT_BYTES,
  SIGN_CONTEXT_REVEAL,
  SIGN_CONTEXT_SEAL,
  decodeFragment,
  decryptSecret,
  deriveKeys,
  encodeFragment,
  encryptSecret,
  fromBase64Url,
  randomBytes,
  signChallenge,
  toBase64Url,
} from "@/lib/crypto";
import type { ExpiresIn } from "@/lib/server/config";
import { api } from "./api";

/**
 * The two end-to-end flows, orchestrating crypto + API. Plaintext, master key
 * and password never leave these functions except into the URL fragment.
 */

export interface SealOutcome {
  id: string;
  /** Everything after `#` — appended to the share link client-side only. */
  fragment: string;
  restrictedRetrieval: boolean;
  expiresAt: Date;
}

export async function sealFlow(
  plaintext: string,
  password: string | null,
  expiresIn: ExpiresIn,
): Promise<SealOutcome> {
  const { id, challenge, restrictedRetrieval } = await api.initSecret(
    expiresIn,
  );

  const masterKey = randomBytes(MASTER_KEY_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const keys = await deriveKeys(masterKey, password, salt);

  const { ciphertext, nonce } = await encryptSecret(keys.encKey, plaintext);
  const signature = signChallenge(
    SIGN_CONTEXT_SEAL,
    id,
    challenge,
    keys.authSeed,
  );

  await api.sealSecret(id, {
    ciphertext: toBase64Url(ciphertext),
    nonce: toBase64Url(nonce),
    salt: toBase64Url(salt),
    publicKey: toBase64Url(keys.publicKey),
    signature: toBase64Url(signature),
  });

  return {
    id,
    fragment: encodeFragment({
      masterKey,
      passwordProtected: password !== null && password.length > 0,
    }),
    restrictedRetrieval,
    expiresAt: new Date(Date.now() + expiresInMs(expiresIn)),
  };
}

function expiresInMs(expiresIn: ExpiresIn): number {
  const minute = 60 * 1000;
  switch (expiresIn) {
    case "10m":
      return 10 * minute;
    case "1h":
      return 60 * minute;
    case "1d":
      return 24 * 60 * minute;
    case "7d":
      return 7 * 24 * 60 * minute;
    case "30d":
      return 30 * 24 * 60 * minute;
  }
}

export class InvalidFragmentError extends Error {
  constructor() {
    super("The URL fragment is missing or malformed");
    this.name = "InvalidFragmentError";
  }
}

export function parseRevealFragment(hash: string) {
  const fragment = decodeFragment(hash);
  if (!fragment) throw new InvalidFragmentError();
  return fragment;
}

export async function revealFlow(
  id: string,
  hash: string,
  password: string | null,
): Promise<string> {
  const fragment = parseRevealFragment(hash);

  const handshake = await api.handshake(id);
  const salt = fromBase64Url(handshake.salt);

  const keys = await deriveKeys(fragment.masterKey, password, salt);
  const signature = signChallenge(
    SIGN_CONTEXT_REVEAL,
    id,
    handshake.challenge,
    keys.authSeed,
  );

  const { ciphertext, nonce } = await api.retrieve(
    id,
    toBase64Url(signature),
  );

  return decryptSecret(
    keys.encKey,
    fromBase64Url(ciphertext),
    fromBase64Url(nonce),
  );
}
