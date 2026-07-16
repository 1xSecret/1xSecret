import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

import type { Locale } from "@/lib/server/config";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "1xSecret";

const TAGLINES: Record<Locale, { headline: string; sub: string }> = {
  en: {
    headline: "Share a one-time secret",
    sub: "End-to-end encrypted · self-destructing links · open source",
  },
  de: {
    headline: "Geheimnisse einmalig teilen",
    sub: "Ende-zu-Ende verschlüsselt · selbstzerstörende Links · Open Source",
  },
};

async function loadFont(file: string): Promise<Buffer> {
  return readFile(path.join(process.cwd(), "src/assets/fonts", file));
}

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const tagline = TAGLINES[locale] ?? TAGLINES.en;
  const [semiBold, regular] = await Promise.all([
    loadFont("Geist-SemiBold.ttf"),
    loadFont("Geist-Regular.ttf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          backgroundColor: "#09090b",
          backgroundImage:
            "radial-gradient(circle at 25% 25%, #1c1c22 0%, #09090b 55%)",
          color: "#fafafa",
          fontFamily: "Geist",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 64,
            fontWeight: 600,
          }}
        >
          {/* lock glyph */}
          <svg
            width="72"
            height="72"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#22c55e"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            1x<span style={{ color: "#22c55e" }}>Secret</span>
          </span>
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 600 }}>
          {tagline.headline}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 400,
            color: "#a1a1aa",
          }}
        >
          {tagline.sub}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: semiBold, weight: 600, style: "normal" },
        { name: "Geist", data: regular, weight: 400, style: "normal" },
      ],
    },
  );
}
