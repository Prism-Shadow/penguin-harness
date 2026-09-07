/**
 * What every WebSocket handshake on this server checks before it accepts a socket, shared by
 * the terminal stream (terminal/ws.ts) and the API socket (socket/ws.ts).
 *
 * A WebSocket handshake bypasses CORS entirely, so any origin may attempt one and the cookie
 * still rides along. Only a genuinely same-origin page may connect: host AND port must match
 * the Host the browser targeted. Cookies are port-agnostic, so anything looser (hostname-only,
 * or a blanket loopback allowance) would let a page served by any other local server ride the
 * session cookie into a shell or an API session. The Vite dev server proxies with
 * `changeOrigin: false`, so the browser's own Host survives the proxy and this comparison
 * holds in development too.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client (CLI, tests, a server relaying): no ambient cookie to abuse
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.host === (req.headers.host ?? "");
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A malformed percent escape is an invalid credential, not a server error — this
      // runs in the `upgrade` handler, where a throw would take the whole process down.
      return null;
    }
  }
  return null;
}

/** The token of an `Authorization: Bearer <token>` header; null for any other shape. */
export function readBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

/** Answers an upgrade request with a plain HTTP status and closes the socket. */
export function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
