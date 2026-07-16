import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

const base = { DATABASE_URL: "postgres://localhost:5432/x" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({ ...base });
    expect(config.accessMode).toBe("DANGEROUS-PUBLIC");
    expect(config.defaultLanguage).toBe("en");
    expect(config.allowIndexing).toBe(false);
    expect(config.retentionDays).toBe(30);
    expect(config.safeNetworks).toEqual([]);
    expect(config.databaseReplicaUrls).toEqual([]);
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("requires SAFE_NETWORKS in SAFEGUARDED mode", () => {
    expect(() =>
      loadConfig({ ...base, ACCESS_MODE: "SAFEGUARDED" }),
    ).toThrow(/SAFE_NETWORKS/);

    const config = loadConfig({
      ...base,
      ACCESS_MODE: "SAFEGUARDED",
      SAFE_NETWORKS: "10.0.0.0/8, fd00::/8",
    });
    expect(config.safeNetworks).toHaveLength(2);
  });

  it("rejects invalid values with a combined error", () => {
    let message = "";
    try {
      loadConfig({
        ...base,
        ACCESS_MODE: "OPEN",
        DEFAULT_LANGUAGE: "fr",
        SAFE_NETWORKS: "not-a-cidr",
        RETENTION_DAYS: "-1",
        APP_URL: "not a url",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const expected of [
      "ACCESS_MODE",
      "DEFAULT_LANGUAGE",
      "not-a-cidr",
      "RETENTION_DAYS",
      "APP_URL",
    ]) {
      expect(message).toContain(expected);
    }
  });

  it("parses replica URLs and trims empty entries", () => {
    const config = loadConfig({
      ...base,
      DATABASE_REPLICA_URLS:
        "postgres://replica1/x , postgres://replica2/x ,",
    });
    expect(config.databaseReplicaUrls).toEqual([
      "postgres://replica1/x",
      "postgres://replica2/x",
    ]);
  });

  it("normalizes APP_URL (no trailing slash)", () => {
    const config = loadConfig({
      ...base,
      APP_URL: "https://1xsecret.com/",
    });
    expect(config.appUrl).toBe("https://1xsecret.com");
  });

  it("parses booleans leniently", () => {
    for (const value of ["true", "1", "yes"]) {
      expect(
        loadConfig({ ...base, ALLOW_INDEXING: value })
          .allowIndexing,
      ).toBe(true);
    }
    expect(
      loadConfig({ ...base, ALLOW_INDEXING: "false" })
        .allowIndexing,
    ).toBe(false);
  });
});
