import { NextResponse, type NextRequest } from "next/server";

import {
  apiError,
  enforceRateLimit,
  getRequestContext,
  secretIdSchema,
} from "@/lib/server/api";
import { getPublicStatus } from "@/lib/server/secrets";

/**
 * Non-destructive status for the reveal page. GET must never burn anything —
 * link-preview bots and mail scanners hit this, not the retrieval endpoint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = getRequestContext(request);
  const limited = enforceRateLimit("status", context);
  if (limited) return limited;

  const { id } = await params;
  if (!secretIdSchema.safeParse(id).success) {
    return NextResponse.json({ status: "unavailable" });
  }

  try {
    const result = await getPublicStatus(id, context.isSafe);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[1xsecret] status failed:", error);
    return apiError(500, "INTERNAL_ERROR", "Could not load the status.");
  }
}
