import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/server/db";

/** Readiness: database reachable. Used by orchestrator readiness probes. */
export async function GET(): Promise<NextResponse> {
  try {
    await getDb().$primary.execute(sql`SELECT 1`);
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
