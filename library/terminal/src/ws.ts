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
import { WebSocketServer, type WebSocket } from "ws";
import { parseCookieHeader, sessionCookies } from "./cookie.js";
import {
  acceptsOrigin,
  publicOrigin,
  sameOriginSite,
} from "@prismshadow/penguin-library-http/public-origin";
import type { Auth } from "@prismshadow/penguin-library-auth";
import { API_SOCKET_PATH } from "@prismshadow/penguin-library-machine/contract";
import { apiSocketRef, type AttachedStream } from "./socket-ref.js";
import {
  API_SOCKET_DEFLATE,
  compressesApiSocket,
} from "@prismshadow/penguin-library-http/socket-compression";
import type { TerminalManager } from "./manager.js";

/**
 * What the upgrade hands the socket over to, declared here as a port (the server's
 * ServerHmrHost satisfies it structurally): the booted platform instance, and the two
 * in-process accessors its api exposes for the one thing the platform seam cannot
 * carry — a live socket.
 */
export interface TerminalUpgradeApi {
  attachStream?(
    ws: WebSocket,
    attached: AttachedStream,
    url: URL,
    log: (line: string) => void,
  ): void;
  terminals?(): TerminalManager;
}

export interface TerminalUpgradeHost {
  ensure(): Promise<{ api: TerminalUpgradeApi }>;
}

const STREAM_PATH = /^\/api\/terminals\/([^/]+)\/stream$/;

export interface TerminalWebSocketDeps {
  /** The booted platform owns the terminals; the runtime asks it per upgrade. */
  hmr: TerminalUpgradeHost;
  /** PENGUIN_TRUST_PROXY=1 (OriginRule.trustProxy). */
  trustProxy?: boolean;
  /** Desktop mode: the handshake also takes the request's own origin (OriginRule.acceptOwnOrigin). */
  acceptOwnOrigin?: boolean;
  authService: Auth;
  log: (line: string) => void;
}

export function attachTerminalWebSocket(server: HttpServer, deps: TerminalWebSocketDeps): void {
  const wss = new WebSocketServer({
    noServer: true,
    /**
     * Terminal output is the most compressible traffic this server has — repeated prompts,
     * repeated SGR runs, whole repainted screens — and on a phone the bytes are the scarce
     * thing, so it is worth a little CPU here. The settings keep that little: the window is
     * capped so a per-socket deflate context costs kilobytes rather than the default's
     * hundreds, and the client's context is not kept, because a browser's uplink here is a
     * keystroke at a time and has nothing to reuse. Small frames are left uncompressed by
     * the sender itself, per message (terminal/stream.ts), not by a threshold here: ws only
     * applies a config `threshold` to a direction that negotiated no_context_takeover, and
     * this server keeps its context — a shared context is what compresses repeated output
     * best.
     */
    perMessageDeflate: {
      clientNoContextTakeover: true,
      serverMaxWindowBits: 13,
      zlibDeflateOptions: { level: 3, memLevel: 7 },
      concurrencyLimit: 10,
    },
  });
  // The API socket between servers, or to a browser on another computer, compresses its
  // frames, each on its own (socket/compression.ts); this computer's browser does not.
  const compressed = new WebSocketServer({ noServer: true, perMessageDeflate: API_SOCKET_DEFLATE });
  const plain = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // A throw out of an 'upgrade' listener is not this request's failure but the process's:
    // Node emits the event from the connection's data handler, where nothing catches it. So
    // whatever the handshake trips over is caught here, logged, and answered as a 500.
    try {
      handshake(req, socket, head);
    } catch (err) {
      deps.log(`[terminal] upgrade failed: ${err instanceof Error ? err.message : String(err)}`);
      refuse(socket, 500, "Internal Server Error");
    }
  });

  function handshake(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = upgradeTarget(req);
    const match = url === null ? null : STREAM_PATH.exec(url.pathname);
    const apiSocket = url?.pathname === API_SOCKET_PATH;
    // Not ours — another handler's path, or a request target that is no path at all: leave the
    // socket alone so another upgrade handler (or the default "no handler -> destroy"
    // behaviour) can deal with it.
    if (url === null || (!match && !apiSocket)) return;

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
        .map(({ token }) => ({ token, auth: deps.authService.authenticateWithMeta(token) }))
        .find((a) => a.auth !== null) ?? null;
    if (!authed?.auth) return refuse(socket, 401, "Unauthorized");
    const userId = authed.auth.user.userId;
    // What the API socket re-asks of the handshake's login (socket/serve.ts).
    const sessionIsLive = () => deps.authService.sessionIsLive(authed.token);

    // The platform may be mid-swap; ensure() resolves the instance that owns the
    // terminals right now, which is also the one whose protocol should serve this socket.
    void deps.hmr
      .ensure()
      .then((platform) => {
        if (!sessionIsLive()) return refuse(socket, 401, "Unauthorized");
        if (apiSocket) {
          // No terminal lookup: the socket carries the whole API as the cookie's user.
          const ref = apiSocketRef(userId, sessionIsLive);
          const server = compressesApiSocket(req.headers.origin) ? compressed : plain;
          return server.handleUpgrade(req, socket, head, (ws) => {
            platform.api.attachStream?.(ws, ref, streamUrl, deps.log);
          });
        }
        const manager = platform.api.terminals?.();
        const session = manager?.get(match![1] as string);
        if (!session || session.ownerUserId !== userId) {
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
  }
}

function refuse(socket: Duplex, status: number, text: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * The upgrade's path and query, or null when its request target is not one: Node passes an
 * absolute-form target through as it came (`GET http://[ HTTP/1.1`), and `new URL` throws on it.
 */
export function upgradeTarget(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? "/", "http://localhost");
  } catch {
    return null;
  }
}

/**
 * The upgrade paths this file serves: the contributed-endpoint seam (hmr/upgrade-seam.ts) never
 * offers them to a generation, so no module can take a terminal's stream or the API socket.
 */
export function isRuntimeUpgradePath(pathname: string): boolean {
  return pathname === API_SOCKET_PATH || STREAM_PATH.test(pathname);
}
