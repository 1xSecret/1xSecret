import type { Locale } from "./config";

/**
 * Lenient runtime env accessors for rendering paths (metadata, footer, legal
 * pages, robots/sitemap). Unlike getConfig(), these never throw — pages must
 * render even while e.g. DATABASE_URL is missing, and nothing here must ever
 * fail a `next build` (which runs without operator configuration).
 */

export function defaultLanguageEnv(): Locale {
  return process.env.DEFAULT_LANGUAGE === "de" ? "de" : "en";
}

export function indexingAllowedEnv(): boolean {
  return ["true", "1", "yes"].includes(process.env.ALLOW_INDEXING ?? "");
}

export function legalDirEnv(): string {
  return process.env.LEGAL_DIR || `${process.cwd()}/legal`;
}

/**
 * Canonical base URL: APP_URL if configured, otherwise derived from the
 * request headers (reverse-proxy aware).
 */
export function appBaseUrl(requestHeaders?: Headers): string {
  const configured = process.env.APP_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      return url.origin + url.pathname.replace(/\/$/, "");
    } catch {
      // fall through to header derivation
    }
  }
  if (requestHeaders) {
    const host =
      requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (host) {
      const proto =
        requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
        "http";
      return `${proto}://${host}`;
    }
  }
  return "http://localhost:3000";
}
