import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  apiError,
  enforceRateLimit,
  getRequestContext,
  parseJsonBody,
} from "@/lib/server/api";
import { EXPIRES_IN_OPTIONS, getConfig } from "@/lib/server/config";
import { initSecret } from "@/lib/server/secrets";

const initSchema = z.object({
  expiresIn: z.enum(EXPIRES_IN_OPTIONS),
});

/**
 * Phase 1 of creating a secret: reserve an id and receive the seal challenge.
 * The ciphertext follows in PUT /api/secrets/{id}.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = getRequestContext(request);
  const limited = enforceRateLimit("init", context);
  if (limited) return limited;

  const body = await parseJsonBody(request, initSchema);
  if (!body.ok) return body.response;

  try {
    const config = getConfig();
    const { id, challenge } = await initSecret(
      body.data.expiresIn,
      context.isSafe,
    );
    return NextResponse.json(
      {
        id,
        challenge,
        // Lets the create UI warn when retrieval will be network-restricted.
        restrictedRetrieval:
          config.accessMode === "SAFEGUARDED" && !context.isSafe,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[1xsecret] init failed:", error);
    return apiError(500, "INTERNAL_ERROR", "Could not create the secret.");
  }
}
