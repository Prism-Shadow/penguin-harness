/**
 * The same-origin server proxy: `/server/<machineId>/api/…` on THIS server forwards to that
 * machine's server through its tunnel.
 *
 * Addressed by the MACHINE'S OWN id (`/server/QS7J4YVgSovi-Z2c/api/me`), not by the ssh
 * alias it was reached through. An alias is a line in one config file: rename it and every
 * URL and cookie below would change identity, silently logging the user out of a machine
 * that never moved, and two aliases for one host would open two tunnels and two sessions to
 * one server. The machine id is minted by that machine and never changes — and being
 * base64url, it needs no percent-encoding to sit in a path. The window never leaves the local origin — the web
 * app stays served from here and re-points its API (and SSE) calls by prefix, so no
 * navigation gate, no origin switch, no per-origin storage split. Platform code on the
 * seam, like everything else in this module: the whole capability ships by hot push.
 *
 * Only `/api/` paths under the prefix are forwarded: the frontend is deliberately LOCAL
 * (that is the point of the design), so a remote's pages are never proxied.
 *
 * Cookies are the subtle part. Remote sessions must live in the browser under the LOCAL
 * origin without colliding with the local server's own cookies or another remote's, so
 * the proxy renames them per machine: a remote's `penguin_session` becomes
 * `penguin_s_<hex(id)>_penguin_session` on the way in (Set-Cookie), and only cookies
 * carrying this machine's prefix are forwarded on the way out — renamed back, with every
 * local cookie stripped. Each server's whole cookie world (active session, parked jar)
 * then coexists under one origin, per machine.
 *
 * The proxy itself does no auth: the remote authenticates every forwarded request with
 * its own (renamed-back) cookies, exactly as if the browser sat on its origin — and the
 * tunnel port this forwards to is already reachable from this machine, so the route adds
 * no exposure the tunnel had not. It therefore mounts OUTSIDE this server\'s auth
 * middleware; a local session is not a credential over there, and requiring one would mean
 * two logins for one window.
 */
import http from "node:http";
import { Readable } from "node:stream";
import { SESSION_COOKIE } from "../auth/middleware.js";

/** Path prefix of the proxy, chosen by the user's design: `/server/<id>/api/…`. */
export const SERVER_PROXY_PREFIX = "/server/";

/** A parsed proxy path: which machine, and the remote-side path to request. */
export interface ProxyPath {
  /** The machine's own id — what it minted, not the alias it was reached through. */
  machineId: string;
  /** The path forwarded to the remote, always starting `/api/`. */
  remotePath: string;
}

/** Parses `/server/<machineId>/api/…` (query preserved by the caller); null for anything else. */
export function parseProxyPath(pathname: string): ProxyPath | null {
  if (!pathname.startsWith(SERVER_PROXY_PREFIX)) return null;
  const rest = pathname.slice(SERVER_PROXY_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const machineId = decodeURIComponent(rest.slice(0, slash));
  const remotePath = rest.slice(slash);
  if (!remotePath.startsWith("/api/") && remotePath !== "/api") return null;
  return { machineId, remotePath };
}

/**
 * Cookie-name-safe marker for one machine. Keyed by the machine's own id so a browser's
 * remembered session belongs to the MACHINE: re-aliasing the host in ssh config leaves it
 * untouched, and reaching one machine through two aliases finds the same session rather
 * than asking for a second login.
 */
export function cookieMarker(machineId: string): string {
  return `penguin_s_${Buffer.from(machineId, "utf8").toString("hex")}_`;
}

/**
 * The Cookie header the remote should see: this machine's renamed cookies, renamed back —
 * and nothing else. Local cookies (the local session included) never leak to a remote;
 * another machine's cookies never leak across.
 */
export function rewriteRequestCookies(header: string | null, machineId: string): string | null {
  if (header === null) return null;
  const marker = cookieMarker(machineId);
  const kept: string[] = [];
  for (const part of header.split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(marker)) kept.push(cookie.slice(marker.length));
  }
  return kept.length > 0 ? kept.join("; ") : null;
}

/** A Set-Cookie from the remote, renamed into this machine's namespace on the local origin. */
export function rewriteSetCookie(header: string, machineId: string): string {
  const eq = header.indexOf("=");
  if (eq <= 0) return header;
  return `${cookieMarker(machineId)}${header}`;
}

/**
 * The session token in a Cookie header bound for a machine, or null when it carries none.
 *
 * The browser sends it on every proxied request, so a machine somebody signed in to earlier
 * is already presenting a usable session — no second sign-in, and none to ask for. This is
 * the half that makes the held session work for the machines that are ALREADY signed in,
 * rather than only for the next one.
 */
export function sessionInCookieHeader(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const token = sessionTokenOf(part.trim());
    if (token !== null) return token;
  }
  return null;
}

/**
 * The session token in a Set-Cookie from a machine, or null when the line is about anything
 * else. `SESSION_COOKIE` deliberately, by name: a machine's login answers with the cookie its
 * own browser session rides in, and that value IS a session on that machine — the same one
 * `penguin auth login` stores. Reading it here is how one sign-in serves both sides.
 */
export function sessionTokenOf(header: string): string | null {
  const eq = header.indexOf("=");
  if (eq <= 0 || header.slice(0, eq).trim() !== SESSION_COOKIE) return null;
  const value =
    header
      .slice(eq + 1)
      .split(";")[0]
      ?.trim() ?? "";
  return value === "" ? null : value;
}

/** An absolute-path Location from the remote, re-rooted under the proxy prefix. */
export function rewriteLocation(header: string, machineId: string): string {
  return header.startsWith("/")
    ? `${SERVER_PROXY_PREFIX}${encodeURIComponent(machineId)}${header}`
    : header;
}

/** Hop-by-hop and addressing headers that must not be forwarded verbatim. */
const DROP_REQUEST_HEADERS = new Set(["host", "cookie", "connection", "keep-alive", "upgrade"]);
const DROP_RESPONSE_HEADERS = new Set(["set-cookie", "location", "connection", "keep-alive"]);

/**
 * Forwards one request to the machine's tunnel port and streams the answer back — both
 * directions are pipes, so SSE and long downloads flow as they arrive. node:http rather
 * than fetch for the same reason as elsewhere: the Host header must be the canonical app
 * host (`localhost:<port>`) while the connection goes to 127.0.0.1, and fetch ignores an
 * explicit host header.
 */
export function proxyToTunnel(
  request: Request,
  path: ProxyPath,
  port: number,
  onSession?: (machineId: string, token: string) => void,
): Promise<Response> {
  return new Promise((resolve) => {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (!DROP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    });
    headers["host"] = `localhost:${port}`;
    const forwardedCookies = rewriteRequestCookies(request.headers.get("cookie"), path.machineId);
    if (forwardedCookies !== null) {
      headers["cookie"] = forwardedCookies;
      // What the browser is presenting IS a session on that machine, and it presents it on
      // every request — so a machine signed in to before this side ever kept one is already
      // handing it over. Recorded from the request rather than waiting for the next
      // Set-Cookie, which would mean asking somebody to sign in again to a machine they are
      // demonstrably signed in to.
      const token = sessionInCookieHeader(forwardedCookies);
      if (token !== null) onSession?.(path.machineId, token);
    }

    const upstream = http.request(
      {
        host: "127.0.0.1",
        port,
        path: `${path.remotePath}${url.search}`,
        method: request.method,
        headers,
      },
      (res) => {
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined || DROP_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
          out.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        for (const cookie of res.headers["set-cookie"] ?? []) {
          // A person signing in to that machine — by hand, with a password this side never
          // sees — is the machine issuing a session. Kept for THIS side's own work on it, so
          // that proving who you are once is enough: the model sync and the hot update stop
          // having to obtain a credential of their own, which is what they cannot do on a
          // machine whose password was set by a person.
          const token = sessionTokenOf(cookie);
          if (token !== null) onSession?.(path.machineId, token);
          out.append("set-cookie", rewriteSetCookie(cookie, path.machineId));
        }
        if (res.headers.location !== undefined) {
          out.set("location", rewriteLocation(res.headers.location, path.machineId));
        }
        resolve(
          new Response(
            res.statusCode === 204 || res.statusCode === 304
              ? null
              : (Readable.toWeb(res) as ReadableStream),
            { status: res.statusCode ?? 502, headers: out },
          ),
        );
      },
    );
    upstream.on("error", (err) => {
      resolve(
        Response.json(
          {
            error: {
              code: "server_unreachable",
              message: `The tunnel to ${path.machineId} did not answer: ${err.message}`,
            },
          },
          { status: 502 },
        ),
      );
    });
    if (request.body !== null) {
      Readable.fromWeb(request.body as import("node:stream/web").ReadableStream).pipe(upstream);
    } else {
      upstream.end();
    }
  });
}

/**
 * The seam handler: `/server/<id>/api/…` → that machine's tunnel, or a clear answer when
 * there is nothing to forward to. `portFor` is the machines service's live-tunnel lookup;
 * a machine without one answers 503 with its own code, which the web reads as "run a
 * connect first".
 */
export function machinesProxy(
  portFor: (machineId: string) => Promise<number | null>,
  onSession?: (machineId: string, token: string) => void,
): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const path = parseProxyPath(new URL(request.url).pathname);
    if (path === null) return null;
    const port = await portFor(path.machineId);
    if (port === null) {
      return Response.json(
        {
          error: {
            code: "not_connected",
            message: `No live tunnel to ${path.machineId}; connect to it first.`,
          },
        },
        { status: 503 },
      );
    }
    return proxyToTunnel(request, path, port, onSession);
  };
}
