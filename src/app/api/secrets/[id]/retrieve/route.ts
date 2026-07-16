import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ED25519_SIGNATURE_BYTES, fromBase64Url } from "@/lib/crypto";
import {
  apiError,
  base64urlSchema,
  enforceRateLimit,
  getRequestContext,
  parseJsonBody,
  restricted,
  secretIdSchema,
  unavailable,
} from "@/lib/server/api";
import { retrieveSecret } from "@/lib/server/secrets";

const retrieveSchema = z.object({
  signature: base64urlSchema(ED25519_SIGNATURE_BYTES),
});

/**
 * Phase 2 of retrieval: verify the challenge signature and atomically burn
 * the secret. A wrong password yields an invalid signature and is rejected
 * WITHOUT ever destroying the secret; repeated wrong guesses from the same
 * client are slowed by an exponential backoff (429 with retryAfter).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = getRequestContext(request);
  const limited = enforceRateLimit("retrieve", context);
  if (limited) return limited;

  const { id } = await params;
  if (!secretIdSchema.safeParse(id).success) {
    return unavailable();
  }

  const body = await parseJsonBody(request, retrieveSchema);
  if (!body.ok) return body.response;

  try {
    const result = await retrieveSecret(
      id,
      fromBase64Url(body.data.signature),
      context.isSafe,
      context.ip,
    );
    if (!result.ok) {
      switch (result.reason) {
        case "restricted":
          return restricted();
        case "locked":
          return NextResponse.json(
            {
              error: {
                code: "TOO_MANY_ATTEMPTS",
                message:
                  "Too many attempts from your network. Try again later.",
                retryAfterSeconds: result.retryAfterSeconds,
              },
            },
            {
              status: 429,
              headers: { "retry-after": String(result.retryAfterSeconds) },
            },
          );
        case "invalid_signature":
          return NextResponse.json(
            {
              error: {
                code: "INVALID_SIGNATURE",
                message:
                  "The signature is invalid — wrong password or corrupted link.",
                retryAfterSeconds: result.retryAfterSeconds,
              },
            },
            {
              status: 401,
              ...(result.retryAfterSeconds
                ? { headers: { "retry-after": String(result.retryAfterSeconds) } }
                : {}),
            },
          );
        default:
          return unavailable();
      }
    }
    return NextResponse.json({
      ciphertext: result.ciphertext,
      nonce: result.nonce,
    });
  } catch (error) {
    console.error("[1xsecret] retrieve failed:", error);
    return apiError(500, "INTERNAL_ERROR", "Could not retrieve the secret.");
  }
}
