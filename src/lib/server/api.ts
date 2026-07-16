import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ipInAnyCidr } from "./cidr";
import { resolveClientIp } from "./client-ip";
import { getConfig } from "./config";
import { rateLimit, RATE_LIMITS } from "./rate-limit";

/**
 * Shared plumbing for the JSON API. Error responses use stable machine-
 * readable codes; "does not exist", "expired" and "already retrieved" are
 * deliberately indistinguishable (SECRET_UNAVAILABLE) to avoid existence
 * oracles.
 */

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "SECRET_UNAVAILABLE"
  | "RETRIEVAL_RESTRICTED"
  | "INVALID_SIGNATURE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const unavailable = () =>
  apiError(
    404,
    "SECRET_UNAVAILABLE",
    "This secret does not exist, has expired, or has already been retrieved.",
  );

export const restricted = () =>
  apiError(
    403,
    "RETRIEVAL_RESTRICTED",
    "This secret can only be retrieved from an allowed network.",
  );

export interface RequestContext {
  /** Resolved client IP (display form; may be empty if unresolvable). */
  ip: string;
  /** Whether the client is inside SAFE_NETWORKS (false if none configured). */
  isSafe: boolean;
}

export function getRequestContext(request: NextRequest): RequestContext {
  const config = getConfig();
  const resolved = resolveClientIp(request.headers, config.trustedProxies);
  return {
    ip: resolved.ip,
    isSafe: ipInAnyCidr(resolved.parsed, config.safeNetworks),
  };
}

export function enforceRateLimit(
  name: keyof typeof RATE_LIMITS,
  context: RequestContext,
): NextResponse | null {
  const { limit, windowMs } = RATE_LIMITS[name];
  const key = `${name}:${context.ip || "unknown"}`;
  if (!rateLimit(key, limit, windowMs)) {
    return apiError(429, "RATE_LIMITED", "Too many requests. Try again soon.");
  }
  return null;
}

export async function parseJsonBody<Schema extends z.ZodType>(
  request: NextRequest,
  schema: Schema,
): Promise<
  | { ok: true; data: z.infer<Schema> }
  | { ok: false; response: NextResponse }
> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError(400, "INVALID_REQUEST", "Body must be valid JSON."),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(400, "INVALID_REQUEST", detail),
    };
  }
  return { ok: true, data: parsed.data };
}

// Unpadded base64url length is never ≡ 1 (mod 4): 1 leftover char cannot
// encode any byte. Rejecting it in the schema keeps fromBase64Url from throwing
// (which would surface as a 500 instead of a clean 400).
const validBase64urlLength = (s: string) => s.length % 4 !== 1;

/** Base64url string of an exact decoded byte length. */
export function base64urlSchema(bytes: number) {
  const expectedLength = Math.ceil((bytes * 4) / 3);
  return z
    .string()
    .length(expectedLength)
    .regex(/^[A-Za-z0-9_-]+$/, "must be base64url")
    .refine(validBase64urlLength, "must be base64url");
}

/** Base64url string up to a maximum decoded byte length. */
export function base64urlMaxSchema(maxBytes: number) {
  return z
    .string()
    .min(1)
    .max(Math.ceil((maxBytes * 4) / 3))
    .regex(/^[A-Za-z0-9_-]+$/, "must be base64url")
    .refine(validBase64urlLength, "must be base64url");
}

export const secretIdSchema = z
  .string()
  .length(21)
  .regex(/^[A-Za-z0-9_-]+$/, "must be a valid secret id");
