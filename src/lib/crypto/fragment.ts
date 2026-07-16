import { fromBase64Url, toBase64Url } from "./encoding";
import { MASTER_KEY_BYTES, SCHEME_VERSION } from "./constants";

/**
 * URL fragment format: `v1.<base64url(masterKey)>[.pw]`
 *
 * The fragment never leaves the browser. The optional `.pw` flag only tells the
 * retrieval page to render a password field — the server never learns whether a
 * secret is password-protected.
 */

export interface FragmentData {
  masterKey: Uint8Array;
  passwordProtected: boolean;
}

export function encodeFragment(data: FragmentData): string {
  const parts = [SCHEME_VERSION, toBase64Url(data.masterKey)];
  if (data.passwordProtected) {
    parts.push("pw");
  }
  return parts.join(".");
}

export function decodeFragment(fragment: string): FragmentData | null {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const parts = raw.split(".");
  if (parts.length < 2 || parts.length > 3 || parts[0] !== SCHEME_VERSION) {
    return null;
  }
  if (parts.length === 3 && parts[2] !== "pw") {
    return null;
  }
  let masterKey: Uint8Array;
  try {
    masterKey = fromBase64Url(parts[1]);
  } catch {
    return null;
  }
  if (masterKey.length !== MASTER_KEY_BYTES) {
    return null;
  }
  return { masterKey, passwordProtected: parts.length === 3 };
}
