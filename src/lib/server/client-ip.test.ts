import { describe, expect, it } from "vitest";

import { resolveClientIp, SOCKET_IP_HEADER } from "./client-ip";
import { parseCidrList } from "./cidr";

function headersOf(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

const trusted = parseCidrList("10.0.0.0/8, ::1/128, 127.0.0.0/8").cidrs;

describe("resolveClientIp", () => {
  it("direct exposure: socket peer wins, spoofed XFF is ignored", () => {
    const result = resolveClientIp(
      headersOf({
        [SOCKET_IP_HEADER]: "203.0.113.7",
        "x-forwarded-for": "10.0.0.1", // spoofed by the client
      }),
      trusted,
    );
    expect(result.ip).toBe("203.0.113.7");
  });

  it("direct exposure without any trusted proxies configured", () => {
    const result = resolveClientIp(
      headersOf({
        [SOCKET_IP_HEADER]: "203.0.113.7",
        "x-forwarded-for": "192.168.0.1",
      }),
      [],
    );
    expect(result.ip).toBe("203.0.113.7");
  });

  it("behind one trusted proxy: rightmost untrusted XFF entry wins", () => {
    const result = resolveClientIp(
      headersOf({
        [SOCKET_IP_HEADER]: "10.0.0.5",
        "x-forwarded-for": "198.51.100.9",
      }),
      trusted,
    );
    expect(result.ip).toBe("198.51.100.9");
  });

  it("client-spoofed prefix behind a proxy is skipped", () => {
    // Client sent "X-Forwarded-For: 1.1.1.1", proxy appended the real peer.
    const result = resolveClientIp(
      headersOf({
        [SOCKET_IP_HEADER]: "10.0.0.5",
        "x-forwarded-for": "1.1.1.1, 198.51.100.9",
      }),
      trusted,
    );
    expect(result.ip).toBe("198.51.100.9");
  });

  it("proxy chain: intermediate trusted hops are skipped", () => {
    const result = resolveClientIp(
      headersOf({
        [SOCKET_IP_HEADER]: "10.0.0.5",
        "x-forwarded-for": "198.51.100.9, 10.0.0.4, 10.0.0.3",
      }),
      trusted,
    );
    expect(result.ip).toBe("198.51.100.9");
  });

  it("all XFF entries trusted: leftmost wins (client inside the proxy network)", () => {
    const result = resolveClientIp(
      headersOf({
        [SOCKET_IP_HEADER]: "10.0.0.5",
        "x-forwarded-for": "10.0.0.9, 10.0.0.4",
      }),
      trusted,
    );
    expect(result.ip).toBe("10.0.0.9");
  });

  it("trusted proxy but no XFF: falls back to the proxy address", () => {
    const result = resolveClientIp(
      headersOf({ [SOCKET_IP_HEADER]: "10.0.0.5" }),
      trusted,
    );
    expect(result.ip).toBe("10.0.0.5");
  });

  it("no socket header: falls back to rightmost XFF", () => {
    const result = resolveClientIp(
      headersOf({ "x-forwarded-for": "1.1.1.1, 198.51.100.9" }),
      trusted,
    );
    expect(result.ip).toBe("198.51.100.9");
  });

  it("nothing available: empty result", () => {
    const result = resolveClientIp(headersOf({}), trusted);
    expect(result.ip).toBe("");
    expect(result.parsed).toBeNull();
  });

  it("normalizes IPv4-mapped socket addresses for display", () => {
    const result = resolveClientIp(
      headersOf({ [SOCKET_IP_HEADER]: "::ffff:203.0.113.7" }),
      trusted,
    );
    expect(result.ip).toBe("203.0.113.7");
    expect(result.parsed).not.toBeNull();
  });

  it("handles port-suffixed XFF entries", () => {
    const result = resolveClientIp(
      headersOf({
        [SOCKET_IP_HEADER]: "10.0.0.5",
        "x-forwarded-for": "198.51.100.9:44321",
      }),
      trusted,
    );
    expect(result.ip).toBe("198.51.100.9");
  });
});
