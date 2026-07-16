/**
 * White-label / branding configuration. Read leniently from the environment
 * (never throws, never runs at build time) so operators can rebrand the single
 * prebuilt image without forking:
 *
 *   APP_NAME              display name (default "1xSecret")
 *   BRAND_LOGO_PATH       absolute path to a mounted logo file (svg/png/…)
 *   LANDING_MODE          "full" (marketing landing) | "minimal" (just the form)
 *   SHOW_SOURCE_LINK      "false" hides the source-repo link in the footer
 *   SOURCE_URL            upstream project URL (attribution + source link)
 *   MESSAGES_OVERRIDE_DIR dir with {en,de}.json partial message overrides
 */

export const DEFAULT_APP_NAME = "1xSecret";
export const UPSTREAM_PROJECT_NAME = "1xSecret";
export const UPSTREAM_PROJECT_URL = "https://github.com/1xSecret/1xSecret";

export type LandingMode = "full" | "minimal";

export function appName(): string {
  const name = process.env.APP_NAME?.trim();
  return name && name.length > 0 ? name : DEFAULT_APP_NAME;
}

/** Whether the app name is the default (renders the styled "1x"+"Secret"). */
export function isDefaultAppName(): boolean {
  return appName() === DEFAULT_APP_NAME;
}

export function landingMode(): LandingMode {
  return process.env.LANDING_MODE === "minimal" ? "minimal" : "full";
}

export function brandLogoPath(): string | null {
  const path = process.env.BRAND_LOGO_PATH?.trim();
  return path && path.length > 0 ? path : null;
}

export function showSourceLink(): boolean {
  // Default true; only an explicit falsey value hides the source link.
  return !["false", "0", "no"].includes(
    (process.env.SHOW_SOURCE_LINK ?? "").trim().toLowerCase(),
  );
}

/**
 * The project this instance is based on. Operators may point SOURCE_URL at
 * their own modified sources (AGPL §13: a modified network service must offer
 * its source to users); the attribution to the upstream project stays.
 */
export function sourceUrl(): string {
  const url = process.env.SOURCE_URL?.trim();
  if (!url) return UPSTREAM_PROJECT_URL;
  try {
    return new URL(url).toString();
  } catch {
    return UPSTREAM_PROJECT_URL;
  }
}

export function messagesOverrideDir(): string | null {
  const dir = process.env.MESSAGES_OVERRIDE_DIR?.trim();
  return dir && dir.length > 0 ? dir : null;
}
