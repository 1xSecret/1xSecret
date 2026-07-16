import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  MAX_CIPHERTEXT_BYTES,
  NONCE_BYTES,
  SALT_BYTES,
  fromBase64Url,
} from "@/lib/crypto";
import {
  apiError,
  base64urlMaxSchema,
  base64urlSchema,
  enforceRateLimit,
  getRequestContext,
  parseJsonBody,
  secretIdSchema,
  unavailable,
} from "@/lib/server/api";
import { sealSecret } from "@/lib/server/secrets";

const sealSchema = z.object({
  ciphertext: base64urlMaxSchema(MAX_CIPHERTEXT_BYTES),
  nonce: base64urlSchema(NONCE_BYTES),
  salt: base64urlSchema(SALT_BYTES),
  publicKey: base64urlSchema(ED25519_PUBLIC_KEY_BYTES),
  signature: base64urlSchema(ED25519_SIGNATURE_BYTES),
});

/**
 * Phase 2 of creating a secret: store the sealed payload. The signature over
 * the init challenge binds the uploaded public key to the key material the
 * creator derived client-side.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = getRequestContext(request);
  const limited = enforceRateLimit("seal", context);
  if (limited) return limited;

  const { id } = await params;
  if (!secretIdSchema.safeParse(id).success) {
    return unavailable();
  }

  const body = await parseJsonBody(request, sealSchema);
  if (!body.ok) return body.response;

  try {
    const result = await sealSecret(id, {
      ciphertext: fromBase64Url(body.data.ciphertext),
      nonce: fromBase64Url(body.data.nonce),
      salt: fromBase64Url(body.data.salt),
      publicKey: fromBase64Url(body.data.publicKey),
      signature: fromBase64Url(body.data.signature),
    });

    if (result === "invalid_signature") {
      return apiError(
        400,
        "INVALID_SIGNATURE",
        "The seal signature does not match the challenge.",
      );
    }
    if (result === "unavailable") {
      return unavailable();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[1xsecret] seal failed:", error);
    return apiError(500, "INTERNAL_ERROR", "Could not seal the secret.");
  }
}
