import { NextResponse, type NextRequest } from "next/server";

import { MAX_SECRET_LENGTH } from "@/lib/crypto";
import { getRequestContext } from "@/lib/server/api";
import { getConfig } from "@/lib/server/config";

/**
 * Public instance configuration for the frontend: which mode is active and
 * whether THIS client is inside the safe networks (drives the SAFEGUARDED
 * notices on the create page).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  const context = getRequestContext(request);
  return NextResponse.json(
    {
      mode: config.accessMode,
      clientIsSafe: context.isSafe,
      defaultLanguage: config.defaultLanguage,
      maxSecretLength: MAX_SECRET_LENGTH,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
