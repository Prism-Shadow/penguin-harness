/**
 * A machine's end of the hub's channel: `GET /api/builtin-browser/hub/ws` (Upgrade), the socket
 * the server that added this machine opens through its ssh connection, carrying the person's own
 * browser over there (hub-link.ts owns the protocol). The browser module contributes it as a
 * WebSocket endpoint with `auth: "user"` (module.ts): the host has checked the session cookie
 * — the one the hub minted here with `penguin auth token` — before this runs.
 *
 * Only the handshake, and three refusals on top of the host's:
 *
 * - An `Origin` is refused (403). Only another server's process dials this, and it sends none; a
 *   browser always does, and a page must never ride an admin's cookie into the person's browser.
 * - A non-admin is refused (403): the channel acts for the hub's admin, as every request the hub
 *   sends a machine does.
 * - A server that runs inside the desktop app takes no hub (404): it is nobody's machine.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { UpgradeCaller, WebSocketUpgrade } from "@prismshadow/penguin-server/plugin";
import type { ExtensionSocket } from "./extension-link.js";
import { socketOf } from "./extension-ws.js";

export const HUB_WS_PATH = "/api/builtin-browser/hub/ws";
/** A screenshot of a tall page is the largest frame: well under this. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

/** Where an admitted socket goes: the generation's browser, which says whether it takes a hub. */
export interface HubGate {
  acceptsHub(): boolean;
  connectHub(socket: ExtensionSocket): void;
}

export interface HubWebSocketDeps {
  /** The gate the socket goes to; null while there is none. */
  gate(): HubGate | null;
  log(line: string): void;
}

export function hubUpgrade(deps: HubWebSocketDeps): WebSocketUpgrade {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_FRAME_BYTES,
  });
  const upgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    caller: UpgradeCaller | null,
  ): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== HUB_WS_PATH) return refuse(socket, 404, "Not Found");
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== "") return refuse(socket, 403, "Forbidden");
    if (caller === null || !caller.user.isAdmin) return refuse(socket, 403, "Forbidden");
    const gate = deps.gate();
    if (gate === null || !gate.acceptsHub()) return refuse(socket, 404, "Not Found");
    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("error", (err) => deps.log(`[hub browser] socket error: ${err.message}`));
        gate.connectHub(socketOf(ws));
      });
    } catch (err) {
      deps.log(`[hub browser] upgrade failed: ${err instanceof Error ? err.message : String(err)}`);
      refuse(socket, 500, "Internal Server Error");
    }
  };
  return { upgrade };
}

function refuse(socket: Duplex, status: number, text: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
