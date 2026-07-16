import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  apiError,
  enforceRateLimit,
  getRequestContext,
  parseJsonBody,
  secretIdSchema,
} from "@/lib/server/api";
import { getCreatorStatuses } from "@/lib/server/secrets";

const batchSchema = z.object({
  ids: z.array(secretIdSchema).min(1).max(100),
});

/**
 * Batch status for the creator's local history ("My secrets"). Ids are
 * 126-bit random capabilities, so possession of an id is the authorization.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = getRequestContext(request);
  const limited = enforceRateLimit("status", context);
  if (limited) return limited;

  const body = await parseJsonBody(request, batchSchema);
  if (!body.ok) return body.response;

  try {
    const statuses = await getCreatorStatuses(body.data.ids);
    return NextResponse.json(
      { secrets: statuses },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[1xsecret] batch status failed:", error);
    return apiError(500, "INTERNAL_ERROR", "Could not load statuses.");
  }
}
