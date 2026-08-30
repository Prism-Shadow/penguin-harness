/**
 * The same-origin proxy's other half: `/server/<machineId>/api/…` upgrades.
 *
 * machines/proxy.ts forwards requests, and a request is something a seam handler can return
 * whole. An upgrade is not: the socket outlives the handshake, so it is the RUNTIME that
 * owns it — the same reason the terminal's own transport lives in terminal/ws.ts rather than
 * in the platform. Without this a terminal on a machine had nowhere to connect: the REST
 * calls that create it proxied fine, and the stream that makes it a terminal was dropped by
 * an upgrade handler that only recognised local paths.
 *
 * ONE IDENTITY, exactly as the request proxy states it: the caller is this server's admin,
 * this server's admin is that machine's admin, and the session presented over there is one
 * this server minted over ssh. So the browser's credential is checked HERE — its cookie and
 * its Origin, by the very functions the local terminal upgrade uses — and neither travels.
 *
 * Once the far side answers 101 this is a pipe. The protocol over it (terminal frames,
 * backpressure, restore) is the machine's business and never this server's; what flows
 * through is bytes.
 */
import http from "node:http";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { SESSION_COOKIE } from "../auth/middleware.js";
import { isAllowedOrigin, readCookie, refuse } from "../terminal/ws.js";
import { parseProxyPath } from "./proxy.js";
import type { AuthService } from "../auth/service.js";
import type { HmrHost } from "../hmr/host.js";

/**
 * Headers that must not cross. Hop-by-hop ones are rewritten below for the upstream
 * handshake; `cookie` and `origin` are dropped for the reason in the module doc — the
 * browser's session is this server's, and the machine's upgrade guard reads a missing
 * Origin as a non-browser client, which is exactly what this is by the time it gets there.
 */
const DROP = new Set(["host", "cookie", "origin", "connection", "upgrade"]);

export interface MachineWebSocketProxyDeps {
  hmr: HmrHost;
  authService: AuthService;
  log: (line: string) => void;
}

export function attachMachineWebSocketProxy(
  server: HttpServer,
  deps: MachineWebSocketProxyDeps,
): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = parseProxyPath(url.pathname);
    // Not ours: leave the socket for the local terminal transport, or for the default
    // "no handler -> destroy". Both handlers are registered, and each declines silently.
    if (path === null) return;

    if (!isAllowedOrigin(req)) return refuse(socket, 403, "Forbidden");
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token === null || deps.authService.authenticateWithMeta(token) === null) {
      return refuse(socket, 401, "Unauthorized");
    }

    void deps.hmr
      .ensure()
      .then(async (platform) => {
        const machines = platform.api.business()?.machines;
        const target = machines ? await machines.proxyTarget(path.machineId) : null;
        if (target === null || target === undefined) {
          // The same answer the request proxy gives, in the only shape a handshake has.
          return refuse(socket, 503, "Not Connected");
        }
        tunnel(req, socket, head, `${path.remotePath}${url.search}`, target, deps.log);
      })
      .catch((err: unknown) => {
        deps.log(
          `[machines] upgrade to ${path.machineId} failed: ${err instanceof Error ? err.message : err}`,
        );
        refuse(socket, 502, "Bad Gateway");
      });
  });
}

/** Hands the client's handshake to the machine and, on 101, joins the two sockets. */
function tunnel(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  path: string,
  target: { port: number; cookie: string },
  log: (line: string) => void,
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
    refuse(socket, res.statusCode ?? 502, res.statusMessage ?? "Bad Gateway");
    res.resume();
  });

  upstream.on("error", (err) => {
    log(`[machines] forward did not answer an upgrade: ${err.message}`);
    refuse(socket, 502, "Bad Gateway");
  });

  upstream.end();
}
