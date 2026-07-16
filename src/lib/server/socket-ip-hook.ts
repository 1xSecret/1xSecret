import http from "node:http";
import type { IncomingMessage } from "node:http";

import { SOCKET_IP_HEADER } from "./client-ip";

/**
 * Anchor client-IP resolution to the TCP socket (see client-ip.ts).
 *
 * Next.js standalone does not support custom servers and route handlers never
 * see the socket, so this hook patches the Node HTTP server's request
 * dispatch: before Next.js handles a request, the internal header is ALWAYS
 * overwritten with socket.remoteAddress — a value supplied by the client (or
 * a proxy) can never get through. Prototype patching covers servers created
 * before or after installation.
 */
export function installSocketIpHook(): void {
  const proto = http.Server.prototype as http.Server & {
    __1xsecretSocketIpHook?: boolean;
  };
  if (proto.__1xsecretSocketIpHook) return;
  proto.__1xsecretSocketIpHook = true;

  const originalEmit = proto.emit;

  proto.emit = function patchedEmit(
    this: http.Server,
    event: string | symbol,
    ...args: unknown[]
  ): boolean {
    if (event === "request") {
      const req = args[0] as IncomingMessage | undefined;
      if (req?.headers) {
        const address = req.socket?.remoteAddress;
        if (address) {
          req.headers[SOCKET_IP_HEADER] = address;
        } else {
          delete req.headers[SOCKET_IP_HEADER];
        }
      }
    }
    return originalEmit.apply(this, [event, ...args] as Parameters<
      typeof originalEmit
    >);
  } as typeof proto.emit;
}
