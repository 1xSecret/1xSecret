/**
 * Dependency-free IPv4/IPv6 CIDR matching.
 *
 * All addresses are normalized to a 128-bit bigint (IPv4 as IPv4-mapped IPv6,
 * ::ffff:a.b.c.d), so a single comparison path covers both families and
 * IPv4-mapped addresses match IPv4 CIDRs transparently.
 */

export interface Cidr {
  /** Network address as 128-bit bigint (IPv4 mapped into ::ffff:0:0/96). */
  base: bigint;
  /** Prefix length in the 128-bit space. */
  prefix: number;
  /** Original notation, for error messages and display. */
  source: string;
}

const V4_MAPPED_PREFIX = 0xffffn << 32n;

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255 || (part.length > 1 && part.startsWith("0"))) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return V4_MAPPED_PREFIX | value;
}

function parseIpv6(ip: string): bigint | null {
  // Strip zone index (fe80::1%eth0).
  const zoneless = ip.split("%")[0];
  const doubleColon = zoneless.split("::");
  if (doubleColon.length > 2) return null;

  const parseGroups = (part: string): bigint[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const out: bigint[] = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (i === groups.length - 1 && group.includes(".")) {
        const v4 = parseIpv4(group);
        if (v4 === null) return null;
        const v4bits = v4 & 0xffffffffn;
        out.push(v4bits >> 16n, v4bits & 0xffffn);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        out.push(BigInt(parseInt(group, 16)));
      }
    }
    return out;
  };

  const head = parseGroups(doubleColon[0]);
  if (head === null) return null;
  let groups: bigint[];
  if (doubleColon.length === 2) {
    const tail = parseGroups(doubleColon[1]);
    if (tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<bigint>(missing).fill(0n), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  return groups.reduce((acc, g) => (acc << 16n) | g, 0n);
}

/**
 * Parse an IP address (IPv4, IPv6, or bracketed/port-suffixed forms as they
 * appear in X-Forwarded-For entries). Returns null for garbage.
 */
export function parseIp(raw: string): bigint | null {
  let ip = raw.trim();
  if (ip === "") return null;

  // "[::1]:8080" or "[::1]"
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end === -1) return null;
    ip = ip.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    // "1.2.3.4:5678"
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }

  if (ip.includes(":")) return parseIpv6(ip);
  return parseIpv4(ip);
}

export function isIpv4(value: bigint): boolean {
  return value >> 32n === 0xffffn;
}

export function parseCidr(notation: string): Cidr | null {
  const source = notation.trim();
  const slash = source.lastIndexOf("/");
  const ipPart = slash === -1 ? source : source.slice(0, slash);
  const ip = parseIp(ipPart);
  if (ip === null) return null;

  const v4 = isIpv4(ip) && !ipPart.includes(":");
  const maxPrefix = v4 ? 32 : 128;
  let prefix = maxPrefix;
  if (slash !== -1) {
    const prefixPart = source.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixPart)) return null;
    prefix = Number(prefixPart);
    if (prefix > maxPrefix) return null;
  }

  // IPv4 prefixes live in the lower 32 bits of the mapped space.
  const prefix128 = v4 ? prefix + 96 : prefix;
  const mask = prefix128 === 0 ? 0n : ((1n << BigInt(prefix128)) - 1n) << BigInt(128 - prefix128);
  return { base: ip & mask, prefix: prefix128, source };
}

export function parseCidrList(value: string): { cidrs: Cidr[]; invalid: string[] } {
  const cidrs: Cidr[] = [];
  const invalid: string[] = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const cidr = parseCidr(trimmed);
    if (cidr) {
      cidrs.push(cidr);
    } else {
      invalid.push(trimmed);
    }
  }
  return { cidrs, invalid };
}

export function ipInCidr(ip: bigint, cidr: Cidr): boolean {
  if (cidr.prefix === 0) return true;
  const mask = ((1n << BigInt(cidr.prefix)) - 1n) << BigInt(128 - cidr.prefix);
  return (ip & mask) === cidr.base;
}

export function ipInAnyCidr(ip: bigint | null, cidrs: Cidr[]): boolean {
  if (ip === null) return false;
  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}
