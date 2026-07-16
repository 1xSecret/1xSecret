import { parseCidrList, type Cidr } from "./cidr";

/**
 * Runtime configuration. Everything is read from process.env at runtime (never
 * NEXT_PUBLIC_*), so one prebuilt image serves every operator configuration.
 *
 * Nothing in this module runs at import time: `next build` must succeed
 * without any configuration. Fail-fast validation happens once at server
 * start, from instrumentation.ts.
 */

export const ACCESS_MODES = ["DANGEROUS-PUBLIC", "SAFEGUARDED"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export const EXPIRES_IN_OPTIONS = ["10m", "1h", "1d", "7d", "30d"] as const;
export type ExpiresIn = (typeof EXPIRES_IN_OPTIONS)[number];

export const EXPIRES_IN_MS: Record<ExpiresIn, number> = {
  "10m": 10 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export interface AppConfig {
  databaseUrl: string;
  databaseReplicaUrls: string[];
  appUrl: string | null;
  defaultLanguage: Locale;
  accessMode: AccessMode;
  safeNetworks: Cidr[];
  trustedProxies: Cidr[];
  allowIndexing: boolean;
  retentionDays: number;
  legalDir: string;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(
      `Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

export type ConfigEnv = Record<string, string | undefined>;

export function loadConfig(env: ConfigEnv = process.env): AppConfig {
  const problems: string[] = [];

  const databaseUrl = env.DATABASE_URL ?? "";
  if (databaseUrl === "") {
    problems.push("DATABASE_URL is required");
  }

  const databaseReplicaUrls = (env.DATABASE_REPLICA_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url !== "");

  let appUrl: string | null = null;
  if (env.APP_URL) {
    try {
      const parsed = new URL(env.APP_URL);
      appUrl = parsed.origin + parsed.pathname.replace(/\/$/, "");
    } catch {
      problems.push(`APP_URL is not a valid URL: ${env.APP_URL}`);
    }
  }

  const defaultLanguage = (env.DEFAULT_LANGUAGE ?? "en") as Locale;
  if (!LOCALES.includes(defaultLanguage)) {
    problems.push(
      `DEFAULT_LANGUAGE must be one of ${LOCALES.join(", ")} (got "${env.DEFAULT_LANGUAGE}")`,
    );
  }

  const accessMode = (env.ACCESS_MODE ?? "DANGEROUS-PUBLIC") as AccessMode;
  if (!ACCESS_MODES.includes(accessMode)) {
    problems.push(
      `ACCESS_MODE must be one of ${ACCESS_MODES.join(", ")} (got "${env.ACCESS_MODE}")`,
    );
  }

  const safeNetworksRaw = env.SAFE_NETWORKS ?? "";
  const safeNetworksParsed = parseCidrList(safeNetworksRaw);
  for (const invalid of safeNetworksParsed.invalid) {
    problems.push(`SAFE_NETWORKS contains an invalid CIDR: "${invalid}"`);
  }
  if (accessMode === "SAFEGUARDED" && safeNetworksParsed.cidrs.length === 0) {
    problems.push(
      "ACCESS_MODE=SAFEGUARDED requires SAFE_NETWORKS (comma-separated CIDRs)",
    );
  }

  const trustedProxiesParsed = parseCidrList(env.TRUSTED_PROXIES ?? "");
  for (const invalid of trustedProxiesParsed.invalid) {
    problems.push(`TRUSTED_PROXIES contains an invalid CIDR: "${invalid}"`);
  }

  const retentionDaysRaw = env.RETENTION_DAYS ?? "30";
  const retentionDays = Number(retentionDaysRaw);
  if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 3650) {
    problems.push(
      `RETENTION_DAYS must be an integer between 0 and 3650 (got "${retentionDaysRaw}")`,
    );
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    databaseUrl,
    databaseReplicaUrls,
    appUrl,
    defaultLanguage,
    accessMode,
    safeNetworks: safeNetworksParsed.cidrs,
    trustedProxies: trustedProxiesParsed.cidrs,
    allowIndexing: parseBoolean(env.ALLOW_INDEXING),
    retentionDays,
    legalDir: env.LEGAL_DIR || `${process.cwd()}/legal`,
  };
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test-only: force re-parsing of process.env. */
export function resetConfigCache(): void {
  cached = null;
}
