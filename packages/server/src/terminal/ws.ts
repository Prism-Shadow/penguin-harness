/**
 * Terminal stream WebSocket: `GET /api/terminals/:id/stream` (Upgrade).
 *
 * Everything except the byte stream stays on plain HTTP (see http/routes/terminals.ts); this
 * carries only the data plane, in the binary framing from frames.ts.
 *
 * Attach sequence — the part that makes a browser reload look seamless:
 *   1. the client's geometry (?cols=&rows=) resizes the pty *first*, so the snapshot is
 *      rendered at the width the client is about to display it at;
 *   2. one Restore frame replays the whole screen;
 *   3. live output follows, coalesced.
 * Any output produced between 2 and 3 would be a lost line, so the output subscription is
 * opened before the snapshot is rendered and buffered until the Restore frame is out.
 *
 * Auth: the session cookie rides along on the upgrade request, so the same credential as the
 * REST API is used, plus an Origin check — a WebSocket handshake is not subject to CORS, so
 * without it any page the user visits could open a shell on this machine.
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { AuthService } from "../auth/service.js";
import { SESSION_COOKIE } from "../auth/middleware.js";
import {
  TerminalStreamOpcode,
  decodeTerminalFrame,
  encodeTerminalFrame,
  framePayloadText,
  parseResizePayload,
} from "./frames.js";
import { TerminalOutputCoalescer } from "./output-coalescer.js";
import type { TerminalManager } from "./manager.js";
import type { TerminalSession } from "./session.js";

const STREAM_PATH = /^\/api\/terminals\/([^/]+)\/stream$/;

/**
 * Cap on bytes queued towards one viewer. `ws.send` buffers without limit when the peer
 * cannot drain; a detached or slow viewer attached to a noisy shell would otherwise grow
 * server memory unboundedly, once per viewer.
 */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export interface TerminalWebSocketDeps {
  manager: TerminalManager;
  authService: AuthService;
  log: (line: string) => void;
}

export function attachTerminalWebSocket(server: HttpServer, deps: TerminalWebSocketDeps): void {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = STREAM_PATH.exec(url.pathname);
    // Not ours: leave the socket alone so another upgrade handler (or the default
    // "no handler -> destroy" behaviour) can deal with it.
    if (!match) return;

    if (!isAllowedOrigin(req)) return refuse(socket, 403, "Forbidden");

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const authed = token ? deps.authService.authenticateWithMeta(token) : null;
    if (!authed) return refuse(socket, 401, "Unauthorized");

    const session = deps.manager.get(match[1] as string);
    if (!session || session.ownerUserId !== authed.user.userId) {
      return refuse(socket, 404, "Not Found");
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      bindStream(ws, session, url, deps.log);
    });
  });
}

function bindStream(
  ws: WebSocket,
  session: TerminalSession,
  url: URL,
  log: (line: string) => void,
): void {
  const connectionId = randomUUID();
  ws.binaryType = "nodebuffer";

  const send = (bytes: Uint8Array): void => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(bytes);
    // Backpressure: cut a lagging viewer off instead of buffering for it forever — a
    // reattach rebuilds the exact screen from the server-side snapshot anyway.
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      log(
        `[terminal] stream ${session.id}: viewer too slow (${ws.bufferedAmount}B queued), disconnecting`,
      );
      ws.terminate();
    }
  };

  // Buffers output until the Restore frame has been sent (see the attach sequence above).
  let restored = false;
  let preRestore = "";
  const coalescer = new TerminalOutputCoalescer((data) => {
    send(encodeTerminalFrame({ opcode: TerminalStreamOpcode.Output, payload: data }));
  });

  const unsubscribeOutput = session.onOutput((data) => {
    if (!restored) {
      preRestore += data;
      return;
    }
    coalescer.push(data);
  });

  const unsubscribeExit = session.onExit((info) => {
    coalescer.flush();
    send(
      encodeTerminalFrame({
        opcode: TerminalStreamOpcode.Exit,
        payload: JSON.stringify({ exitCode: info.exitCode, signal: info.signal }),
      }),
    );
  });

  // The attaching client's geometry wins: it is the viewport the user is looking at, and the
  // snapshot below is laid out for it.
  const cols = Number.parseInt(url.searchParams.get("cols") ?? "", 10);
  const rows = Number.parseInt(url.searchParams.get("rows") ?? "", 10);
  if (Number.isInteger(cols) && Number.isInteger(rows)) {
    session.resize({ connectionId, cols, rows, intent: "claim" });
  }

  send(
    encodeTerminalFrame({
      opcode: TerminalStreamOpcode.Restore,
      payload: session.restoreStream(),
    }),
  );
  restored = true;
  if (preRestore) {
    coalescer.push(preRestore);
    preRestore = "";
  }
  if (!session.alive && session.exit) {
    send(
      encodeTerminalFrame({
        opcode: TerminalStreamOpcode.Exit,
        payload: JSON.stringify({ exitCode: session.exit.exitCode, signal: session.exit.signal }),
      }),
    );
  }

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (!isBinary) return; // the data plane is binary-only
    const frame = decodeTerminalFrame(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    if (!frame) return;
    switch (frame.opcode) {
      case TerminalStreamOpcode.Input:
        session.write(framePayloadText(frame));
        break;
      case TerminalStreamOpcode.Resize: {
        const size = parseResizePayload(frame);
        if (size) session.resize({ connectionId, ...size });
        break;
      }
      default:
        break; // server-only opcodes echoed back by a confused client
    }
  });

  const teardown = (): void => {
    unsubscribeOutput();
    unsubscribeExit();
    coalescer.dispose();
    // Closing a view must not resize or kill the shell — only give up size ownership so the
    // next client to attach can claim it.
    session.releaseSize(connectionId);
  };

  ws.on("close", teardown);
  ws.on("error", (err: Error) => {
    log(`[terminal] stream ${session.id} socket error: ${err.message}`);
    teardown();
  });
}

/**
 * A WebSocket handshake bypasses CORS entirely, so any origin may attempt one and the cookie
 * still rides along. Only a genuinely same-origin page may connect: host AND port must match
 * the Host the browser targeted. Cookies are port-agnostic, so anything looser (hostname-only,
 * or a blanket loopback allowance) would let a page served by any other local server ride the
 * session cookie into a shell. The Vite dev server proxies with `changeOrigin: false`, so the
 * browser's own Host survives the proxy and this comparison holds in development too.
 */
function isAllowedOrigin(req: IncomingMessage): boolean {
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

function readCookie(header: string | undefined, name: string): string | null {
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

function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
