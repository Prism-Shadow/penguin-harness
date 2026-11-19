/**
 * What this runtime still does for the agent browser by name, for a platform pushed before the
 * generic seams it now goes through (2026-11-19). A runtime restores whatever version was pushed
 * last, older than itself included, and such a platform has neither seam:
 *
 * - no WebSocket endpoints (`HttpModule.upgrades`): its browser module provides only the gate the
 *   runtime used to look up by name, `BuiltinBrowserModule` / `BrowserExtensionGate`, so the
 *   runtime runs the extension's handshake over that gate itself — 503 when the generation has
 *   no browser;
 * - no `Http.ownOrigin`: the runtime's same-origin check in front of the seam (app.ts) exempts
 *   the extension's pairing route by its path, as the hard-coded rule did.
 *
 * A FROZEN COPY, not the browser's code: the handshake and the origin rule below are those the
 * runtime ran before the seams (builtin-browser/extension-ws.ts and extension-origin.ts at the
 * time), spelled out here so nothing in the runtime imports the browser — which leaves the
 * server package for a plugin. An older platform speaks exactly this; change it only to fix it.
 *
 * The other direction needs no code here: an installed runtime older than the seams only ever
 * does that name lookup, so the browser module keeps providing those two names beside its
 * contributed endpoint.
 *
 * Compatibility code, kept until 1.0 like the repo's other compatibility code
 * (changelog/unreleased/2026-11-19-backward-compatibility.md); it goes together with those two
 * names.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import { profileFromEnv } from "../machines/layout.js";
import type { ServerHmrHost } from "./platform.js";

const PAIR_PATH = "/api/builtin-browser/extension/pair";
const SOCKET_PATH = "/api/builtin-browser/extension/ws";
const SUBPROTOCOL = "penguin-browser.1";
const TOKEN_PREFIX = "token.";
/** The extension's id, as its pinned manifest key fixes it. */
const EXTENSION_ID = "dodgfhpcbmkjfcbgnoidablfgjjhhmgp";
/** A screenshot of a tall page is the largest frame: well under this. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
/** The close the extension reads as "this server speaks another protocol". */
const PROTOCOL_MISMATCH = 4005;

/** The socket as the older platform's hub speaks to it: text frames in and out. */
export interface LegacyExtensionSocket {
  send(text: string): void;
  close(code: number, reason: string): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: (code: number) => void): void;
}

/** The gate an older platform's browser module exports as `BrowserExtensionGate`. */
export interface LegacyExtensionGate {
  admit(token: string): "ok" | "unknown" | "revoked" | "disabled";
  connect(token: string, socket: LegacyExtensionSocket): void;
}

/** The pairing route's exemption, for a generation that cannot name its own-origin groups. */
export function legacyOwnOrigin(path: string): boolean {
  return path.replace(/\/+$/, "") === PAIR_PATH;
}

/**
 * The extension's WebSocket over the gate the current generation provides by name: the seam's
 * fallback (upgrade-seam.ts), taking only the extension's own path.
 */
export function legacyExtensionUpgrade(
  hmr: ServerHmrHost,
  log: (line: string) => void,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => boolean {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_FRAME_BYTES,
    // The token is offered as a subprotocol too; only the protocol name is ever selected.
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });
  const gateByName = async (): Promise<LegacyExtensionGate | null> => {
    const platform = await hmr.ensure();
    const tree = typeof platform.api.business === "function" ? platform.api.business() : null;
    if (tree === null || !tree.has("BuiltinBrowserModule")) return null;
    try {
      return tree.api<LegacyExtensionGate>("BuiltinBrowserModule", "BrowserExtensionGate");
    } catch {
      // A pushed platform from before the extension: no gate, so the upgrade is a 503.
      return null;
    }
  };
  return (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== SOCKET_PATH) return false;
    // Cookies are never read: the extension's token, offered as a subprotocol, is the credential,
    // and only the extension's own origin (or a non-browser client, with no Origin) may use it.
    if (!isAllowedOrigin(request.headers.origin)) {
      refuse(socket, 403, "Forbidden");
      return true;
    }
    const { offered, token } = readSubprotocols(request.headers["sec-websocket-protocol"]);
    if (token === null) {
      refuse(socket, 401, "Unauthorized");
      return true;
    }
    void gateByName()
      .then((gate) => {
        if (gate === null) return refuse(socket, 503, "Service Unavailable");
        if (gate.admit(token) === "unknown") return refuse(socket, 401, "Unauthorized");
        wss.handleUpgrade(request, socket, head, (ws) => {
          ws.on("error", (err) => log(`[browser extension] socket error: ${err.message}`));
          if (!offered.includes(SUBPROTOCOL)) {
            ws.close(PROTOCOL_MISMATCH, "protocol_mismatch");
            return;
          }
          gate.connect(token, socketOf(ws));
        });
      })
      .catch((err: unknown) => {
        log(
          `[browser extension] upgrade failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        refuse(socket, 500, "Internal Server Error");
      });
    return true;
  };
}

/** The extension's page or service worker (any extension's on a dev-profile server), or no browser at all. */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin === "") return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "chrome-extension:") return false;
  return url.host === EXTENSION_ID || profileFromEnv(process.env) === "dev";
}

function readSubprotocols(header: string | string[] | undefined): {
  offered: string[];
  token: string | null;
} {
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
  const offered = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const token = offered.find((p) => p.startsWith(TOKEN_PREFIX))?.slice(TOKEN_PREFIX.length) ?? "";
  return { offered, token: /^[A-Za-z0-9_-]{16,256}$/.test(token) ? token : null };
}

function socketOf(ws: WebSocket): LegacyExtensionSocket {
  const textOf = (data: RawData): string => {
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    return Buffer.from(data).toString("utf8");
  };
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

function refuse(socket: Duplex, status: number, text: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
