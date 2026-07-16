import { describe, expect, it } from "vitest";

import {
  ipInAnyCidr,
  ipInCidr,
  parseCidr,
  parseCidrList,
  parseIp,
} from "./cidr";

function inCidr(ip: string, cidr: string): boolean {
  const parsedIp = parseIp(ip);
  const parsedCidr = parseCidr(cidr);
  if (parsedIp === null || parsedCidr === null) {
    throw new Error(`bad input ${ip} / ${cidr}`);
  }
  return ipInCidr(parsedIp, parsedCidr);
}

describe("parseIp", () => {
  it("parses IPv4", () => {
    expect(parseIp("192.168.1.1")).not.toBeNull();
    expect(parseIp("0.0.0.0")).not.toBeNull();
    expect(parseIp("255.255.255.255")).not.toBeNull();
  });

  it("parses IPv6 incl. compressed and mapped forms", () => {
    expect(parseIp("::1")).not.toBeNull();
    expect(parseIp("2001:db8::8a2e:370:7334")).not.toBeNull();
    expect(parseIp("::ffff:192.168.1.1")).not.toBeNull();
    expect(parseIp("fe80::1%eth0")).not.toBeNull();
  });

  it("strips ports and brackets (X-Forwarded-For forms)", () => {
    expect(parseIp("1.2.3.4:5678")).toEqual(parseIp("1.2.3.4"));
    expect(parseIp("[::1]:8080")).toEqual(parseIp("::1"));
    expect(parseIp("[2001:db8::1]")).toEqual(parseIp("2001:db8::1"));
  });

  it("rejects garbage", () => {
    expect(parseIp("")).toBeNull();
    expect(parseIp("256.1.1.1")).toBeNull();
    expect(parseIp("01.2.3.4")).toBeNull();
    expect(parseIp("1.2.3")).toBeNull();
    expect(parseIp("unknown")).toBeNull();
    expect(parseIp("2001:db8:::1")).toBeNull();
    expect(parseIp("12345::")).toBeNull();
  });

  it("normalizes IPv4-mapped IPv6 to the same value as IPv4", () => {
    expect(parseIp("::ffff:10.1.2.3")).toEqual(parseIp("10.1.2.3"));
  });
});

describe("ipInCidr", () => {
  it("matches IPv4 CIDRs", () => {
    expect(inCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(inCidr("11.1.2.3", "10.0.0.0/8")).toBe(false);
    expect(inCidr("192.168.1.42", "192.168.1.0/24")).toBe(true);
    expect(inCidr("192.168.2.42", "192.168.1.0/24")).toBe(false);
    expect(inCidr("172.16.5.5", "172.16.0.0/12")).toBe(true);
    expect(inCidr("172.32.0.1", "172.16.0.0/12")).toBe(false);
  });

  it("treats a bare IP as a host route", () => {
    expect(inCidr("1.2.3.4", "1.2.3.4")).toBe(true);
    expect(inCidr("1.2.3.5", "1.2.3.4")).toBe(false);
  });

  it("matches IPv6 CIDRs", () => {
    expect(inCidr("2001:db8::1", "2001:db8::/32")).toBe(true);
    expect(inCidr("2001:db9::1", "2001:db8::/32")).toBe(false);
    expect(inCidr("::1", "::1/128")).toBe(true);
    expect(inCidr("fd00::1234", "fd00::/8")).toBe(true);
  });

  it("matches IPv4-mapped IPv6 addresses against IPv4 CIDRs", () => {
    expect(inCidr("::ffff:10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(inCidr("::ffff:11.1.2.3", "10.0.0.0/8")).toBe(false);
  });

  it("0.0.0.0/0 matches all IPv4 but not IPv6", () => {
    expect(inCidr("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(inCidr("2001:db8::1", "0.0.0.0/0")).toBe(false);
    expect(inCidr("2001:db8::1", "::/0")).toBe(true);
  });
});

describe("parseCidr validation", () => {
  it("rejects invalid notations", () => {
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("2001:db8::/129")).toBeNull();
    expect(parseCidr("10.0.0.0/x")).toBeNull();
    expect(parseCidr("banana/8")).toBeNull();
    expect(parseCidr("")).toBeNull();
  });
});

describe("parseCidrList", () => {
  it("splits, trims and reports invalid entries", () => {
    const { cidrs, invalid } = parseCidrList(
      " 10.0.0.0/8 , 192.168.0.0/16, nope, fd00::/8 ,",
    );
    expect(cidrs).toHaveLength(3);
    expect(invalid).toEqual(["nope"]);
  });
});

describe("ipInAnyCidr", () => {
  it("returns false for null ip or empty list", () => {
    expect(ipInAnyCidr(null, [parseCidr("10.0.0.0/8")!])).toBe(false);
    expect(ipInAnyCidr(parseIp("10.0.0.1"), [])).toBe(false);
  });
});
