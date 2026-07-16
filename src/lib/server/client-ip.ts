import { ipInAnyCidr, parseIp, type Cidr } from "./cidr";

/**
 * Client IP resolution, anchored to the TCP socket.
 *
 * Route handlers cannot access the socket, and X-Forwarded-For from the wire
 * is attacker-controlled when no reverse proxy is in front. instrumentation.ts
 * therefore hooks the Node HTTP server and ALWAYS overwrites the internal
 * header below with socket.remoteAddress before Next.js sees the request —
 * a client-supplied value can never survive.
 */
export const SOCKET_IP_HEADER = "x-1xsecret-socket-ip";

export interface ResolvedClientIp {
  /** Display form of the resolved client address. */
  ip: string;
  /** Parsed 128-bit form for CIDR checks; null if unparseable. */
  parsed: bigint | null;
}

/**
 * Rightmost-untrusted X-Forwarded-For resolution:
 *
 * 1. The socket peer is authoritative. If it is NOT a trusted proxy, the
 *    socket peer IS the client (any XFF header it sent is ignored — direct
 *    exposure without a proxy stays spoof-proof).
 * 2. If the socket peer is a trusted proxy, walk XFF right-to-left and return
 *    the first entry that is not itself a trusted proxy; if every entry is
 *    trusted, return the leftmost.
 */
export function resolveClientIp(
  headers: Headers,
  trustedProxies: Cidr[],
): ResolvedClientIp {
  const socketIpRaw = headers.get(SOCKET_IP_HEADER) ?? "";
  const socketIp = parseIp(socketIpRaw);

  const trustSocketPeer =
    socketIp !== null &&
    trustedProxies.length > 0 &&
    ipInAnyCidr(socketIp, trustedProxies);

  if (!trustSocketPeer) {
    if (socketIp !== null) {
      return { ip: normalizeDisplay(socketIpRaw), parsed: socketIp };
    }
    // No socket header (e.g. a runtime where the instrumentation hook did not
    // attach). Next.js fills XFF from the socket when the header is absent,
    // so the rightmost entry is the best remaining evidence — but it is only
    // trustworthy behind a proxy. SAFEGUARDED deployments must run the Node
    // server (see docs/SELF-HOSTING.md).
    const entries = xffEntries(headers);
    const last = entries[entries.length - 1];
    return last !== undefined
      ? { ip: normalizeDisplay(last), parsed: parseIp(last) }
      : { ip: "", parsed: null };
  }

  const entries = xffEntries(headers);
  for (let i = entries.length - 1; i >= 0; i--) {
    const parsed = parseIp(entries[i]);
    if (parsed === null || !ipInAnyCidr(parsed, trustedProxies)) {
      return { ip: normalizeDisplay(entries[i]), parsed };
    }
  }
  if (entries.length > 0) {
    const first = entries[0];
    return { ip: normalizeDisplay(first), parsed: parseIp(first) };
  }
  // Trusted proxy in front, but no XFF forwarded: fall back to the proxy
  // address itself (better than nothing; operators should fix proxy config).
  return { ip: normalizeDisplay(socketIpRaw), parsed: socketIp };
}

function xffEntries(headers: Headers): string[] {
  const value = headers.get("x-forwarded-for");
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function normalizeDisplay(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) ip = ip.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) displays as plain IPv4.
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}
