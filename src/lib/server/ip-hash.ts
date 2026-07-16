import { createHash, createHmac } from "node:crypto";

import { getConfig } from "./config";

/**
 * HMAC of a client IP for use as a rate-limit key. Raw IPs are never stored.
 *
 * IPv4 has only 32 bits of entropy, so a plain hash is trivially reversible by
 * brute force — an HMAC with a server-side pepper prevents anyone with the
 * database from recovering the addresses. The pepper is taken from
 * RATE_LIMIT_HASH_SECRET when set; otherwise it is derived deterministically
 * from DATABASE_URL, which is already secret and identical across replicas, so
 * the hash stays consistent for the DB-backed backoff without extra config.
 */

let cachedPepper: string | null = null;

function pepper(): string {
  if (cachedPepper !== null) return cachedPepper;
  const explicit = process.env.RATE_LIMIT_HASH_SECRET;
  cachedPepper = explicit
    ? explicit
    : createHash("sha256")
        .update(`1xsecret/ip-hash/v1:${getConfig().databaseUrl}`)
        .digest("hex");
  return cachedPepper;
}

/**
 * Stable, non-reversible key for a client IP. An empty/unknown IP maps to a
 * single shared bucket so unresolved clients still share one throttle rather
 * than bypassing it.
 */
export function hashIp(ip: string): string {
  const normalized = ip.trim() || "unknown";
  return createHmac("sha256", pepper()).update(normalized).digest("hex");
}

/** Test-only: force the pepper to be recomputed. */
export function resetIpHashCache(): void {
  cachedPepper = null;
}
