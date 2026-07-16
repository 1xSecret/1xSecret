import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { brandLogoPath } from "@/lib/server/branding";

/**
 * Serves the operator-provided brand logo mounted at BRAND_LOGO_PATH. The path
 * is a fixed operator setting (never user input), so there is no traversal
 * surface. Served same-origin so it satisfies the `img-src 'self'` CSP.
 *
 * SVG is served with its own content type; because the header references the
 * logo via <img src>, any script inside an SVG is inert (img never executes
 * SVG scripts).
 */
const CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

export async function GET(): Promise<NextResponse> {
  const logoPath = brandLogoPath();
  if (!logoPath) {
    return new NextResponse(null, { status: 404 });
  }

  const ext = path.extname(logoPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return new NextResponse(null, { status: 415 });
  }

  try {
    const data = await readFile(logoPath);
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
