import type { ExpiresIn } from "@/lib/server/config";

/**
 * Typed client for the 1xSecret JSON API. Only ciphertext and signatures ever
 * travel through these calls — plaintext, keys and passwords stay in the
 * calling code.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let code = "INTERNAL_ERROR";
    let message = `Request failed (${response.status})`;
    let retryAfterSeconds: number | undefined;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; retryAfterSeconds?: number };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      retryAfterSeconds = body.error?.retryAfterSeconds ?? undefined;
    } catch {
      // keep defaults
    }
    throw new ApiError(response.status, code, message, retryAfterSeconds);
  }
  return (await response.json()) as T;
}

export interface InstanceConfig {
  mode: "DANGEROUS-PUBLIC" | "SAFEGUARDED";
  clientIsSafe: boolean;
  defaultLanguage: string;
  maxSecretLength: number;
}

export const api = {
  getConfig: () => request<InstanceConfig>("/api/config"),

  initSecret: (expiresIn: ExpiresIn) =>
    request<{ id: string; challenge: string; restrictedRetrieval: boolean }>(
      "/api/secrets",
      { method: "POST", body: JSON.stringify({ expiresIn }) },
    ),

  sealSecret: (
    id: string,
    payload: {
      ciphertext: string;
      nonce: string;
      salt: string;
      publicKey: string;
      signature: string;
    },
  ) =>
    request<{ ok: boolean }>(`/api/secrets/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  getRevealStatus: (id: string) =>
    request<{ status: "available" | "restricted" | "unavailable" }>(
      `/api/secrets/${id}/status`,
    ),

  handshake: (id: string) =>
    request<{ salt: string; challenge: string }>(
      `/api/secrets/${id}/handshake`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  retrieve: (id: string, signature: string) =>
    request<{ ciphertext: string; nonce: string }>(
      `/api/secrets/${id}/retrieve`,
      { method: "POST", body: JSON.stringify({ signature }) },
    ),

  batchStatus: (ids: string[]) =>
    request<{
      secrets: {
        id: string;
        status: "pending" | "retrieved" | "expired" | "unknown";
        retrievedAt: string | null;
        expiresAt: string | null;
      }[];
    }>("/api/secrets/status", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
};
