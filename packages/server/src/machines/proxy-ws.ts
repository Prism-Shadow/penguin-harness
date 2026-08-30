/**
 * The same-origin proxy's other half: `/server/<machineId>/api/…` upgrades.
 *
 * machines/proxy.ts forwards requests, and a request is something a seam handler can return
 * whole. An upgrade is not — the socket outlives the handshake — so it arrives on the socket
 * seam instead (hmr/platform.ts's `upgrade`), which is the same bargain the HTTP seam makes:
 * the runtime authenticates and offers, the PLATFORM decides. This file is the deciding, and
 * it is platform code for the ordinary reason — which machine, over which forward, under
 * whose session, with which headers crossing, is how a capability behaves. Runtime code here
 * would make every later change to any of it a reinstall of every installation.
 *
 * Without it a terminal on a machine had nowhere to connect: the REST calls that create one
 * proxied fine, and the stream that makes it a terminal was dropped by an upgrade handler
 * that only recognised local paths.
 *
 * ONE IDENTITY, exactly as the request proxy states it: the caller is this server's admin,
 * this server's admin is that machine's admin, and the session presented over there is one
 * this server minted over ssh. The browser's own credential was checked by the runtime before
 * this was ever called, and neither it nor its Origin travels.
 *
 * Once the far side answers 101 this is a pipe. The protocol over it (terminal frames,
 * backpressure, restore) is the machine's business and never this server's; what flows
 * through is bytes.
 */
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { parseProxyPath } from "./proxy.js";
import { refuseUpgrade } from "../http-upgrade.js";

/**
 * Headers that must not cross. Hop-by-hop ones are rewritten below for the upstream
 * handshake; `cookie` and `origin` are dropped for the reason in the module doc — the
 * browser's session is this server's, and the machine's upgrade guard reads a missing
 * Origin as a non-browser client, which is exactly what this is by the time it gets there.
 */
const DROP = new Set(["host", "cookie", "origin", "connection", "upgrade"]);

/** Just enough of the machines service to point a socket at a machine. */
export interface MachineForwards {
  proxyTarget(machineId: string): Promise<{ port: number; cookie: string } | null>;
}

/**
 * The socket seam's machines route: false for a handshake not addressed to a machine, true
 * once this has taken the socket — refusals included, since answering 503 is handling it.
 */
export async function proxyUpgradeToMachine(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  url: URL,
  machines: MachineForwards | null,
): Promise<boolean> {
  const path = parseProxyPath(url.pathname);
  if (path === null) return false;
  if (machines === null) {
    // A bare kernel has no machines to reach; the path is still ours to answer for.
    refuseUpgrade(socket, 503, "Not Connected");
    return true;
  }
  let target: { port: number; cookie: string } | null;
  try {
    target = await machines.proxyTarget(path.machineId);
  } catch {
    refuseUpgrade(socket, 502, "Bad Gateway");
    return true;
  }
  if (target === null) {
    // The same answer the request proxy gives, in the only shape a handshake has.
    refuseUpgrade(socket, 503, "Not Connected");
    return true;
  }
  tunnel(req, socket, head, `${path.remotePath}${url.search}`, target);
  return true;
}

/** Hands the client's handshake to the machine and, on 101, joins the two sockets. */
function tunnel(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  path: string,
  target: { port: number; cookie: string },
): void {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || DROP.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  // The canonical app host, as the request proxy does it: the App answers on `localhost`
  // and refuses `127.0.0.1`, while the connection itself goes to the loopback address.
  headers["host"] = `localhost:${target.port}`;
  headers["cookie"] = target.cookie;
  headers["connection"] = "Upgrade";
  headers["upgrade"] = "websocket";

  const upstream = http.request({ host: "127.0.0.1", port: target.port, path, headers });

  upstream.on("upgrade", (res, remote, remoteHead) => {
    // The far side's own 101, verbatim: its Sec-WebSocket-Accept is computed over the key
    // that was forwarded, so it is the client's to verify. Rewriting any of it would only
    // be a chance to get it wrong.
    const lines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage}`];
    for (const [name, value] of Object.entries(res.headers)) {
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${one}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);

    // Bytes either side had already read past its handshake, before the pipes are joined.
    if (remoteHead.length > 0) socket.write(remoteHead);
    if (head.length > 0) remote.write(head);

    // Either end closing takes the other with it: a half-open pipe to a shell is a pane
    // that looks alive and answers nothing.
    const drop = () => {
      remote.destroy();
      socket.destroy();
    };
    remote.on("error", drop);
    socket.on("error", drop);
    remote.on("close", drop);
    socket.on("close", drop);
    remote.pipe(socket);
    socket.pipe(remote);
  });

  // A non-101 means the machine refused the handshake and said why in an ordinary response.
  // Pass its status through rather than inventing one — 404 for a terminal that is not
  // there reads very differently from 401.
  upstream.on("response", (res) => {
    refuseUpgrade(socket, res.statusCode ?? 502, res.statusMessage ?? "Bad Gateway");
    res.resume();
  });

  upstream.on("error", () => refuseUpgrade(socket, 502, "Bad Gateway"));

  upstream.end();
}
