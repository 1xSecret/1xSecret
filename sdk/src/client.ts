import {
  decodeFragment,
  decryptSecret,
  deriveKeys,
  encodeFragment,
  encryptSecret,
  fromBase64Url,
  MASTER_KEY_BYTES,
  MAX_SECRET_LENGTH,
  randomBytes,
  SALT_BYTES,
  signChallenge,
  SIGN_CONTEXT_REVEAL,
  SIGN_CONTEXT_SEAL,
  toBase64Url,
} from "./crypto.js";
import {
  ApiRequestError,
  CreationRestrictedError,
  InvalidLinkError,
  RetrievalRestrictedError,
  RetrievalThrottledError,
  SecretUnavailableError,
  WrongPasswordError,
} from "./errors.js";

export type ExpiresIn = "10m" | "1h" | "1d" | "7d" | "30d";

export interface OneXSecretClientOptions {
  /**
   * Base URL of the 1xSecret instance to talk to. Defaults to the public
   * instance at https://1xsecret.com. Point this at your own self-hosted
   * deployment to keep secrets on your infrastructure.
   */
  apiUrl?: string;
  /** Custom fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
  /** Path prefix for the API (default "/api"). */
  basePath?: string;
}

export interface SealOptions {
  /** The secret text to share (max 500 characters). */
  text: string;
  /**
   * Optional retrieval password. Folded into the encryption key on this
   * machine — it is never sent to the server and is required to decrypt.
   */
  password?: string | null;
  /** How long the link stays valid. Defaults to "1d". */
  expiresIn?: ExpiresIn;
  /** UI locale used to build the share link path (default "en"). */
  locale?: string;
}

export interface SealResult {
  /** The server-side secret id. */
  id: string;
  /**
   * The full one-time link, including the decryption key in the URL fragment.
   * Share this (and the password, if set, over a separate channel).
   */
  link: string;
  /** The URL fragment alone (`v1.<key>[.pw]`), if you build links yourself. */
  fragment: string;
  /** True when this instance restricts where the secret may be retrieved. */
  restrictedRetrieval: boolean;
}

export interface RevealOptions {
  /** A full share link (`https://…/s/<id>#v1.<key>[.pw]`). */
  link?: string;
  /** Alternatively, the secret id … */
  id?: string;
  /** … and the URL fragment (`v1.<key>[.pw]`, with or without a leading `#`). */
  fragment?: string;
  /** The retrieval password, if the secret has one. */
  password?: string | null;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; retryAfterSeconds?: number };
}

const DEFAULT_API_URL = "https://1xsecret.com";

/**
 * A client for a 1xSecret instance. All encryption and decryption happen
 * locally; the server only ever sees ciphertext.
 */
export class OneXSecretClient {
  private readonly apiUrl: string;
  private readonly basePath: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OneXSecretClientOptions = {}) {
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.basePath = options.basePath ?? "/api";
    const f = options.fetch ?? globalThis.fetch;
    if (!f) {
      throw new Error(
        "No fetch implementation available. Use Node >= 18 or pass options.fetch.",
      );
    }
    this.fetchImpl = f;
  }

  /** Seal a secret and return a one-time link. */
  async seal(options: SealOptions): Promise<SealResult> {
    const { text } = options;
    if (text.length === 0) throw new Error("text must not be empty");
    if (text.length > MAX_SECRET_LENGTH) {
      throw new Error(`text must be at most ${MAX_SECRET_LENGTH} characters`);
    }
    const password =
      options.password && options.password.length > 0 ? options.password : null;
    const expiresIn = options.expiresIn ?? "1d";
    const locale = options.locale ?? "en";

    const init = await this.request<{
      id: string;
      challenge: string;
      restrictedRetrieval: boolean;
    }>("POST", "/secrets", { expiresIn });

    const masterKey = randomBytes(MASTER_KEY_BYTES);
    const salt = randomBytes(SALT_BYTES);
    const keys = await deriveKeys(masterKey, password, salt);
    const { ciphertext, nonce } = await encryptSecret(keys.encKey, text);
    const signature = signChallenge(
      SIGN_CONTEXT_SEAL,
      init.id,
      init.challenge,
      keys.authSeed,
    );

    await this.request<{ ok: boolean }>("PUT", `/secrets/${init.id}`, {
      ciphertext: toBase64Url(ciphertext),
      nonce: toBase64Url(nonce),
      salt: toBase64Url(salt),
      publicKey: toBase64Url(keys.publicKey),
      signature: toBase64Url(signature),
    });

    const fragment = encodeFragment(masterKey, password !== null);
    return {
      id: init.id,
      link: `${this.apiUrl}/${locale}/s/${init.id}#${fragment}`,
      fragment,
      restrictedRetrieval: init.restrictedRetrieval,
    };
  }

  /** Reveal (and burn) a secret. Returns the plaintext. */
  async reveal(options: RevealOptions): Promise<string> {
    const { id, fragment } = resolveTarget(options);
    const parsed = decodeFragment(fragment);
    if (!parsed) throw new InvalidLinkError();

    const handshake = await this.request<{ salt: string; challenge: string }>(
      "POST",
      `/secrets/${id}/handshake`,
      {},
    );

    const salt = fromBase64Url(handshake.salt);
    const password =
      options.password && options.password.length > 0 ? options.password : null;
    const keys = await deriveKeys(parsed.masterKey, password, salt);
    const signature = signChallenge(
      SIGN_CONTEXT_REVEAL,
      id,
      handshake.challenge,
      keys.authSeed,
    );

    const payload = await this.request<{ ciphertext: string; nonce: string }>(
      "POST",
      `/secrets/${id}/retrieve`,
      { signature: toBase64Url(signature) },
    );

    return decryptSecret(
      keys.encKey,
      fromBase64Url(payload.ciphertext),
      fromBase64Url(payload.nonce),
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(
      `${this.apiUrl}${this.basePath}${path}`,
      {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );

    if (response.ok) {
      return (await response.json()) as T;
    }

    let parsed: ApiErrorBody = {};
    try {
      parsed = (await response.json()) as ApiErrorBody;
    } catch {
      // non-JSON error body
    }
    const code = parsed.error?.code ?? "INTERNAL_ERROR";
    const message = parsed.error?.message ?? `Request failed (${response.status})`;
    const retryAfter = parsed.error?.retryAfterSeconds ?? null;

    switch (code) {
      case "SECRET_UNAVAILABLE":
        throw new SecretUnavailableError();
      case "RETRIEVAL_RESTRICTED":
        throw new RetrievalRestrictedError();
      case "TOO_MANY_ATTEMPTS":
        throw new RetrievalThrottledError(retryAfter ?? 30);
      case "INVALID_SIGNATURE":
        throw new WrongPasswordError(retryAfter);
      default:
        if (response.status === 403) throw new CreationRestrictedError();
        throw new ApiRequestError(response.status, code, message);
    }
  }
}

function resolveTarget(options: RevealOptions): { id: string; fragment: string } {
  if (options.link) {
    const hashIndex = options.link.indexOf("#");
    if (hashIndex === -1) throw new InvalidLinkError("The link has no key fragment.");
    const fragment = options.link.slice(hashIndex + 1);
    const beforeHash = options.link.slice(0, hashIndex);
    const idMatch = /\/s\/([^/?#]+)/.exec(beforeHash);
    if (!idMatch) throw new InvalidLinkError("Could not find the secret id in the link.");
    return { id: decodeURIComponent(idMatch[1]!), fragment };
  }
  if (options.id && options.fragment) {
    return { id: options.id, fragment: options.fragment };
  }
  throw new Error("Provide either `link`, or both `id` and `fragment`.");
}
