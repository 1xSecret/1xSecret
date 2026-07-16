import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashIp, resetIpHashCache } from "./ip-hash";

describe("hashIp", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_HASH_SECRET = "test-pepper";
    resetIpHashCache();
  });
  afterEach(() => {
    delete process.env.RATE_LIMIT_HASH_SECRET;
    resetIpHashCache();
  });

  it("is deterministic and never contains the raw IP", () => {
    const ip = "203.0.113.42";
    const a = hashIp(ip);
    const b = hashIp(ip);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain(ip);
  });

  it("maps different IPs to different hashes", () => {
    expect(hashIp("203.0.113.1")).not.toBe(hashIp("203.0.113.2"));
    expect(hashIp("::1")).not.toBe(hashIp("::2"));
  });

  it("buckets empty/unknown IPs together", () => {
    expect(hashIp("")).toBe(hashIp("   "));
  });

  it("changes with the pepper", () => {
    const withA = hashIp("203.0.113.1");
    process.env.RATE_LIMIT_HASH_SECRET = "different-pepper";
    resetIpHashCache();
    expect(hashIp("203.0.113.1")).not.toBe(withA);
  });
});
