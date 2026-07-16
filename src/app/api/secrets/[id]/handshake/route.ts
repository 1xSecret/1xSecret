import { NextResponse, type NextRequest } from "next/server";

import {
  apiError,
  enforceRateLimit,
  getRequestContext,
  restricted,
  secretIdSchema,
  unavailable,
} from "@/lib/server/api";
import { createRevealChallenge } from "@/lib/server/secrets";

/**
 * Phase 1 of retrieval: issue a fresh single-use challenge (2 min TTL) plus
 * the KDF salt. Only an explicit user action triggers this.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = getRequestContext(request);
  const limited = enforceRateLimit("handshake", context);
  if (limited) return limited;

  const { id } = await params;
  if (!secretIdSchema.safeParse(id).success) {
    return unavailable();
  }

  try {
    const result = await createRevealChallenge(id, context.isSafe);
    if (!result.ok) {
      return result.reason === "restricted" ? restricted() : unavailable();
    }
    return NextResponse.json({ salt: result.salt, challenge: result.challenge });
  } catch (error) {
    console.error("[1xsecret] handshake failed:", error);
    return apiError(500, "INTERNAL_ERROR", "Could not start the handshake.");
  }
}
