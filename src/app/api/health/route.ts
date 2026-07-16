import { NextResponse } from "next/server";

/** Liveness: process is up. Never touches the database. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok" });
}
