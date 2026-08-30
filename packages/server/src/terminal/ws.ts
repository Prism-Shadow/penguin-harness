/**
 * Terminal stream transport: `GET /api/terminals/:id/stream` (Upgrade).
 *
 * Runtime, and only the transport. A WebSocket cannot cross the platform seam — a seam
 * handler returns one whole Response — so the runtime keeps what an upgrade needs: the
 * handshake itself, the Origin check, and the session-cookie authentication it already
 * owns. The moment the socket is live it is handed to the platform, which owns the
 * protocol that flows over it (terminal/stream.ts): frames, coalescing, restore
 * and backpressure are all pushable, the socket plumbing is not.
 *
 * Auth: the session cookie rides along on the upgrade request, so the same credential as
 * the REST API is used, plus an Origin check — a WebSocket handshake is not subject to
 * CORS, so without it any page the user visits could open a shell on this machine.
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { AuthService } from "../auth/service.js";
import { SESSION_COOKIE } from "../auth/middleware.js";
import type { HmrHost } from "../hmr/host.js";
import { refuseUpgrade, type UpgradeRoute } from "../http-upgrade.js";

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
  hmr: HmrHost;
  authService: AuthService;
  log: (line: string) => void;
}

/**
 * The terminal's upgrade route (http-upgrade.ts): false for a path that is not a terminal
 * stream, true once this has taken the socket — refusals included, since answering 401 is
 * handling it.
 */
export function terminalUpgradeRoute(deps: TerminalWebSocketDeps): UpgradeRoute {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = STREAM_PATH.exec(url.pathname);
    // Not ours. Declining is all this says — the router decides what an unclaimed path gets.
    if (!match) return false;

    if (!isAllowedOrigin(req)) {
      refuse(socket, 403, "Forbidden");
      return true;
    }

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const authed = token ? deps.authService.authenticateWithMeta(token) : null;
    if (!authed) {
      refuse(socket, 401, "Unauthorized");
      return true;
    }

    // The platform may be mid-swap; ensure() resolves the instance that owns the
    // terminals right now, which is also the one whose protocol should serve this socket.
    void deps.hmr
      .ensure()
      .then((platform) => {
        const manager = platform.api.terminals?.();
        const session = manager?.get(match[1] as string);
        if (!session || session.ownerUserId !== authed.user.userId) {
          return refuse(socket, 404, "Not Found");
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          platform.api.attachStream?.(ws, session, url, deps.log);
        });
      })
      .catch((err: unknown) => {
        deps.log(`[terminal] stream upgrade failed: ${err instanceof Error ? err.message : err}`);
        refuse(socket, 500, "Internal Server Error");
      });
    return true;
  };
}

/**
 * The socket seam: an authenticated handshake this runtime does not own is offered to the
 * booted platform, which claims it or declines (hmr/platform.ts's `upgrade`).
 *
 * The upgrade counterpart of the HTTP seam, and there for the same reason: WHICH sockets go
 * where, and what is done with one, is policy — a pushed platform decides it, and no route of
 * its own is added here. What stays is what only the runtime can do. The handshake is
 * authenticated FIRST and here: a WebSocket handshake bypasses CORS entirely while the
 * session cookie rides along, so a socket must be known to be this user's before it is handed
 * anywhere at all.
 *
 * A platform too old to have the member declines by not having it — the socket falls through
 * to the router's 404, which is the honest answer for a build that cannot serve it.
 */
export function platformUpgradeRoute(deps: TerminalWebSocketDeps): UpgradeRoute {
  return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!isAllowedOrigin(req)) {
      refuse(socket, 403, "Forbidden");
      return true;
    }
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token === null || deps.authService.authenticateWithMeta(token) === null) {
      refuse(socket, 401, "Unauthorized");
      return true;
    }
    void deps.hmr
      .ensure()
      .then(async (platform) => {
        // Declined, or a platform without the member: nobody claimed the socket, and a
        // socket nobody claimed must be closed rather than left to hang.
        if ((await platform.api.upgrade?.(req, socket, head, url)) !== true) {
          refuse(socket, 404, "Not Found");
        }
      })
      .catch((err: unknown) => {
        deps.log(`[upgrade] platform seam failed: ${err instanceof Error ? err.message : err}`);
        refuse(socket, 500, "Internal Server Error");
      });
    return true;
  };
}

/**
 * A WebSocket handshake bypasses CORS entirely, so any origin may attempt one and the cookie
 * still rides along. Only a genuinely same-origin page may connect: host AND port must match
 * the Host the browser targeted. Cookies are port-agnostic, so anything looser (hostname-only,
 * or a blanket loopback allowance) would let a page served by any other local server ride the
 * session cookie into a shell. The Vite dev server proxies with `changeOrigin: false`, so the
 * browser's own Host survives the proxy and this comparison holds in development too.
 */
export function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client (CLI, tests): no ambient cookie to abuse
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

/** Answering a handshake with a status is the router's, so both routes answer alike. */
export const refuse = refuseUpgrade;
