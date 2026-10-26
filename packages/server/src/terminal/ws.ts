/**
 * The runtime's two WebSocket upgrade routes: a terminal's stream,
 * `GET /api/terminals/:id/stream`, and the API socket, `GET /api/socket` (the whole API over
 * one socket, PRFC-0011 — api/types.ts's `API_SOCKET_PATH`).
 *
 * Runtime, and only the transport. A WebSocket cannot cross the platform seam — a seam
 * handler returns one whole Response — so the runtime keeps what an upgrade needs: the
 * handshake itself, the Origin check, and the session-cookie authentication it already
 * owns. The moment the socket is live it is handed to the platform, which owns the
 * protocol that flows over it: frames, coalescing, restore and backpressure for a terminal
 * (terminal/stream.ts), calls and their answers for the API socket (socket/serve.ts).
 *
 * Auth: the session cookie rides along on the upgrade request, so the same credential as
 * the REST API is used, plus an Origin check — a WebSocket handshake is not subject to
 * CORS, so without it any page the user visits could open a shell on this machine. A browser
 * that sends `Sec-Fetch-Site` must say `same-origin` there too, as on a write.
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { format } from "node:url";
import { TLSSocket } from "node:tls";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { parseCookieHeader, sessionCookies } from "../auth/middleware.js";
import { acceptsOrigin, publicOrigin, sameOriginSite } from "../http/public-origin.js";
import type { ServerHmrHost } from "../hmr/platform.js";
import type { Auth } from "../mechanisms/identity.js";
import { API_SOCKET_PATH } from "../api/types.js";
import { apiSocketRef } from "../socket/ref.js";

const STREAM_PATH = /^\/api\/terminals\/([^/]+)\/stream$/;

/**
 * Per-viewer backpressure watermarks. `ws.send` queues without limit when the peer cannot
 * drain, so a viewer more than HIGH_WATER behind stops receiving live output — the bytes
 * keep feeding the server emulator, nothing of the session is lost — and once its socket
 * drains below LOW_WATER it is repainted with one fresh Restore frame (the same
 * self-contained repaint an attach uses) and live output resumes. Skipping ahead beats
 * both alternatives: replaying megabytes the viewer could only fast-forward through, or
 * disconnecting it (the client treats a closed stream as a dead pane, not a retry). The
 * high watermark is therefore a LAG bound — how far behind a viewer may fall before it is
 * fast-forwarded — and doubles as the per-viewer memory bound.
 */
const BACKPRESSURE_HIGH_WATER = 1024 * 1024;
const BACKPRESSURE_LOW_WATER = 64 * 1024;
const BACKPRESSURE_POLL_MS = 250;

export interface TerminalWebSocketDeps {
  /** The booted platform owns the terminals; the runtime asks it per upgrade. */
  hmr: ServerHmrHost;
  /** PENGUIN_TRUST_PROXY=1 (OriginRule.trustProxy). */
  trustProxy?: boolean;
  /** Desktop mode: the handshake also takes the request's own origin (OriginRule.acceptOwnOrigin). */
  acceptOwnOrigin?: boolean;
  authService: Auth;
  log: (line: string) => void;
}

export function attachTerminalWebSocket(server: HttpServer, deps: TerminalWebSocketDeps): void {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = STREAM_PATH.exec(url.pathname);
    const apiSocket = url.pathname === API_SOCKET_PATH;
    // Not ours: leave the socket alone so another upgrade handler (or the default
    // "no handler -> destroy" behaviour) can deal with it.
    if (!match && !apiSocket) return;

    let target: URL;
    let streamUrl: URL;
    try {
      // IncomingMessage has no Fetch Request URL; Node formats its transport authority.
      if (!req.headers.host) return refuse(socket, 403, "Forbidden");
      const protocol = req.socket instanceof TLSSocket && req.socket.encrypted ? "https:" : "http:";
      target = new URL(
        format({ protocol, host: req.headers.host, pathname: url.pathname, slashes: true }),
      );
      const header = (name: string): string | undefined => {
        const value = req.headers[name];
        return Array.isArray(value) ? value.join(",") : value;
      };
      const forwarded = { proto: header("x-forwarded-proto"), host: header("x-forwarded-host") };
      const trustProxy = deps.trustProxy ?? false;
      const rule = { trustProxy, acceptOwnOrigin: deps.acceptOwnOrigin ?? false };
      if (
        !sameOriginSite(header("sec-fetch-site")) ||
        !acceptsOrigin(req.headers.origin, target, forwarded, rule)
      ) {
        return refuse(socket, 403, "Forbidden");
      }
      // The platform gets the public origin with the path and query: the API socket addresses
      // every call it carries to that origin, so a route that builds a URL back to the App (an
      // OAuth callback) sees the browser's scheme, host and port, as it does over HTTP.
      streamUrl = new URL(publicOrigin(target, forwarded, trustProxy));
      streamUrl.pathname = url.pathname;
      streamUrl.search = url.search;
    } catch {
      return refuse(socket, 403, "Forbidden");
    }

    const authed =
      sessionCookies(parseCookieHeader(req.headers.cookie), target)
        .map(({ token }) => deps.authService.authenticateWithMeta(token))
        .find((a) => a !== null) ?? null;
    if (!authed) return refuse(socket, 401, "Unauthorized");

    // The platform may be mid-swap; ensure() resolves the instance that owns the
    // terminals right now, which is also the one whose protocol should serve this socket.
    void deps.hmr
      .ensure()
      .then((platform) => {
        if (apiSocket) {
          // No terminal lookup: the socket carries the whole API as the cookie's user.
          const ref = apiSocketRef(authed.user.userId);
          return wss.handleUpgrade(req, socket, head, (ws) => {
            platform.api.attachStream?.(ws, ref, streamUrl, deps.log);
          });
        }
        const manager = platform.api.terminals?.();
        const session = manager?.get(match![1] as string);
        if (!session || session.ownerUserId !== authed.user.userId) {
          return refuse(socket, 404, "Not Found");
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          platform.api.attachStream?.(ws, session, streamUrl, deps.log);
        });
      })
      .catch((err: unknown) => {
        deps.log(`[terminal] stream upgrade failed: ${err instanceof Error ? err.message : err}`);
        refuse(socket, 500, "Internal Server Error");
      });
  });
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
