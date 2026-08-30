/**
 * A terminal on a machine, served through this server's own terminal stream.
 *
 * The runtime serves ONE kind of socket, `/api/terminals/<id>/stream`, and everything it
 * does with it is ask the platform: `terminals().get(id)` for the session, then
 * `attachStream(ws, session, url)` to drive the protocol. It never looks inside either. So a
 * terminal that lives on a machine needs no runtime change at all — the platform answers
 * `get` with a reference to the remote pty, and `attachStream` relays the socket to that
 * machine's own stream over the forward this server already holds. Platform code, pushed
 * like any other; the runtime is exactly what it was.
 *
 * The reference is spelled in the id: `<terminalId>@<machineId>@<userId>`. The user id is
 * there for the runtime's owner check, which compares the session's `ownerUserId` with the
 * authenticated user — a client can only name itself, and an id naming anyone else is
 * refused before this code runs. What that leaves to check here is that the user may reach
 * machines at all, which is this server's admins (the forward's session is an admin's).
 *
 * The relay carries messages verbatim. The protocol (frames, backpressure, restore) is the
 * machine's; both ends speak it and this server does not need to.
 */
import { WebSocket } from "ws";
import type { WebSocket as WsSocket } from "ws";
import { TerminalManager } from "../terminal/manager.js";
import type { TerminalSession } from "../terminal/session.js";

const SEP = "@";

/** A remote pty, in the shape the runtime's owner check reads. */
export interface RemoteTerminalRef {
  id: string;
  ownerUserId: string;
  remote: { machineId: string; terminalId: string };
}

/** `<terminalId>@<machineId>@<userId>`, or null for an ordinary (local) id. */
export function parseRemoteTerminalRef(id: string): RemoteTerminalRef | null {
  let text = id;
  try {
    text = decodeURIComponent(id);
  } catch {
    // A malformed escape cannot name a terminal anywhere; fall through to "not remote".
  }
  const parts = text.split(SEP);
  if (parts.length !== 3 || parts.some((p) => p === "")) return null;
  const [terminalId, machineId, ownerUserId] = parts as [string, string, string];
  return { id: text, ownerUserId, remote: { machineId, terminalId } };
}

export const isRemoteTerminalRef = (session: object): session is RemoteTerminalRef =>
  "remote" in session;

/** The manager, answering `get` for remote references too. */
export class TerminalsAcrossMachines extends TerminalManager {
  override get(id: string): TerminalSession | undefined {
    const local = super.get(id);
    if (local !== undefined) return local;
    const ref = parseRemoteTerminalRef(id);
    // The runtime only reads `ownerUserId` off this before handing it back to attachStream.
    return ref === null ? undefined : (ref as unknown as TerminalSession);
  }
}

export interface RelayDeps {
  proxyTarget(machineId: string): Promise<{ port: number; cookie: string } | null>;
  isAdmin(userId: string): boolean;
}

/**
 * Joins the viewer's socket to the machine's stream for this pty. Closes the viewer with a
 * WebSocket status (not a hang) for every way this can fail: the caller may not reach
 * machines, the machine is not connected, or its stream refused.
 */
export async function relayTerminalStream(
  ws: WsSocket,
  ref: RemoteTerminalRef,
  url: URL,
  deps: RelayDeps,
  log: (line: string) => void,
): Promise<void> {
  if (!deps.isAdmin(ref.ownerUserId)) return ws.close(1008, "forbidden");
  const target = await deps.proxyTarget(ref.remote.machineId).catch(() => null);
  if (target === null) return ws.close(1013, "machine not connected");

  const path = `/api/terminals/${encodeURIComponent(ref.remote.terminalId)}/stream${url.search}`;
  // Canonical host, as the request proxy sends it: the App answers on `localhost` and
  // refuses `127.0.0.1`, while the connection itself goes to the loopback address. No
  // Origin: the machine's guard reads its absence as a non-browser client, which this is.
  const remote = new WebSocket(`ws://127.0.0.1:${target.port}${path}`, {
    headers: { host: `localhost:${target.port}`, cookie: target.cookie },
    perMessageDeflate: false,
  });

  // A close that arrived without a status (1005/1006) cannot be sent as one; ws throws.
  const sendable = (code: number) =>
    code === 1000 ||
    code === 1001 ||
    code === 1008 ||
    code === 1011 ||
    code === 1013 ||
    (code >= 3000 && code <= 4999)
      ? code
      : 1000;
  const closeBoth = (raw: number, reason: string) => {
    const code = sendable(raw);
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason);
    if (remote.readyState === remote.OPEN || remote.readyState === remote.CONNECTING) {
      remote.close(code, reason);
    }
  };

  remote.on("open", () => {
    ws.on("message", (data, isBinary) => {
      if (remote.readyState === remote.OPEN) remote.send(data, { binary: isBinary });
    });
    remote.on("message", (data, isBinary) => {
      if (ws.readyState === ws.OPEN) ws.send(data, { binary: isBinary });
    });
  });
  // A handshake the machine refused: pass its status on as a close reason rather than
  // inventing one — 404 for a pty that is gone reads differently from 401.
  remote.on("unexpected-response", (_req, res) => {
    res.resume();
    closeBoth(1011, `machine answered ${res.statusCode ?? "?"}`);
  });
  remote.on("error", (err) => {
    log(`[machines] terminal relay to ${ref.remote.machineId}: ${err.message}`);
    closeBoth(1011, "relay failed");
  });
  // Either end closing takes the other with it: a half-open pipe to a shell is a pane that
  // looks alive and answers nothing.
  remote.on("close", (code, reason) => closeBoth(code, reason.toString()));
  ws.on("close", (code, reason) => closeBoth(code, reason.toString()));
  ws.on("error", () => closeBoth(1011, "viewer failed"));
}
