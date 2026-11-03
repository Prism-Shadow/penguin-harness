/**
 * The chrome backend's transport: `GET /api/builtin-browser/extension/ws` (Upgrade), the socket
 * the PenguinHarness Browser extension opens to this server.
 *
 * Runtime, and only the handshake — as the terminal stream's (terminal/ws.ts): a WebSocket
 * cannot cross the platform seam, so this checks the request, upgrades, and hands the live
 * socket to the current generation's hub, which owns the protocol (extension-link.ts).
 *
 * Auth is the extension's own token, never the session cookie: a cookie rides along with any
 * page's request, and a page must never ride a signed-in session into the hub, so cookies are
 * not read here at all. The token travels in the subprotocol list —
 * `Sec-WebSocket-Protocol: penguin-browser.1, token.<token>` — so it never lands in a URL or an
 * access log; the server selects `penguin-browser.1`. And the Origin must be the extension's
 * (extension-origin.ts): a web page holding a stolen token cannot connect with it either. A
 * request with no Origin is a non-browser client (a test, a tool), which has no ambient
 * credential to abuse.
 *
 * Refusals: a foreign Origin 403, a missing or unknown token 401, a platform without the
 * browser 503 — before the upgrade. A token the extension should stop using is told after it,
 * with a close code it can act on: 4003 revoked, 4009 switched off by the admin, 4005 when the
 * subprotocol `penguin-browser.1` is missing.
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import type { ExtensionSocket } from "./extension-link.js";
import { isPenguinExtensionOrigin } from "./extension-origin.js";

export const EXTENSION_WS_PATH = "/api/builtin-browser/extension/ws";
export const EXTENSION_SUBPROTOCOL = "penguin-browser.1";
const TOKEN_PREFIX = "token.";
/** A screenshot of a tall page is the largest frame: well under this. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
/**
 * CLOSE.protocolMismatch (extension-link.ts), spelled here: this file runs in the runtime, which
 * a pushed platform cannot update, so it imports nothing of the platform's but types.
 */
const PROTOCOL_MISMATCH = 4005;

/** What the upgrade asks of the current generation (the hub, through the platform). */
export interface ExtensionGate {
  admit(token: string): "ok" | "unknown" | "revoked" | "disabled";
  connect(token: string, socket: ExtensionSocket): void;
}

export interface ExtensionWebSocketDeps {
  /** The current generation's gate; null while there is none (a bare kernel, an older push). */
  gate(): Promise<ExtensionGate | null>;
  log(line: string): void;
}

/** The `ws` socket as the link speaks to it: text frames in and out. */
export function socketOf(ws: WebSocket): ExtensionSocket {
  return {
    send: (text) => ws.send(text),
    close: (code, reason) => ws.close(code, reason),
    onMessage: (listener) =>
      ws.on("message", (data: RawData, isBinary: boolean) => {
        if (!isBinary) listener(textOf(data));
      }),
    onClose: (listener) => ws.on("close", (code: number) => listener(code)),
  };
}

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** The subprotocols the client offered, and the token among them. */
export function readSubprotocols(header: string | string[] | undefined): {
  offered: string[];
  token: string | null;
} {
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
  const offered = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const tokenEntry = offered.find((p) => p.startsWith(TOKEN_PREFIX));
  const token = tokenEntry?.slice(TOKEN_PREFIX.length) ?? "";
  return { offered, token: /^[A-Za-z0-9_-]{16,256}$/.test(token) ? token : null };
}

/** The extension's page or service worker, or no browser at all. */
function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === undefined || origin === "" || isPenguinExtensionOrigin(origin);
}

export function attachExtensionWebSocket(server: HttpServer, deps: ExtensionWebSocketDeps): void {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_FRAME_BYTES,
    // The token is offered as a subprotocol too; only the protocol name is ever selected.
    handleProtocols: (protocols) =>
      protocols.has(EXTENSION_SUBPROTOCOL) ? EXTENSION_SUBPROTOCOL : false,
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Not ours: leave the socket for another upgrade handler.
    if (url.pathname !== EXTENSION_WS_PATH) return;

    if (!isAllowedOrigin(req.headers.origin)) return refuse(socket, 403, "Forbidden");
    const { offered, token } = readSubprotocols(req.headers["sec-websocket-protocol"]);
    if (token === null) return refuse(socket, 401, "Unauthorized");

    void deps
      .gate()
      .then((gate) => {
        if (gate === null) return refuse(socket, 503, "Service Unavailable");
        if (gate.admit(token) === "unknown") return refuse(socket, 401, "Unauthorized");
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.on("error", (err) => deps.log(`[browser extension] socket error: ${err.message}`));
          if (!offered.includes(EXTENSION_SUBPROTOCOL)) {
            ws.close(PROTOCOL_MISMATCH, "protocol_mismatch");
            return;
          }
          gate.connect(token, socketOf(ws));
        });
      })
      .catch((err: unknown) => {
        deps.log(
          `[browser extension] upgrade failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        refuse(socket, 500, "Internal Server Error");
      });
  });
}

function refuse(socket: Duplex, status: number, text: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
