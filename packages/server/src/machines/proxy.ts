/**
 * The same-origin server proxy: `/server/<id>/api/…` on THIS server forwards to machine
 * `<id>`'s server through its tunnel. The window never leaves the local origin — the web
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
 * no exposure the tunnel had not.
 */
import http from "node:http";
import { Readable } from "node:stream";

/** Path prefix of the proxy, chosen by the user's design: `/server/<id>/api/…`. */
export const SERVER_PROXY_PREFIX = "/server/";

/** A parsed proxy path: which machine, and the remote-side path to request. */
export interface ProxyPath {
  /** The machine id (ssh alias), URL-decoded. */
  id: string;
  /** The path forwarded to the remote, always starting `/api/`. */
  remotePath: string;
}

/** Parses `/server/<id>/api/…` (query preserved by the caller); null for anything else. */
export function parseProxyPath(pathname: string): ProxyPath | null {
  if (!pathname.startsWith(SERVER_PROXY_PREFIX)) return null;
  const rest = pathname.slice(SERVER_PROXY_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const id = decodeURIComponent(rest.slice(0, slash));
  const remotePath = rest.slice(slash);
  if (!remotePath.startsWith("/api/") && remotePath !== "/api") return null;
  return { id, remotePath };
}

/** Cookie-name-safe marker for one machine (cookie names cannot carry an alias verbatim). */
export function cookieMarker(id: string): string {
  return `penguin_s_${Buffer.from(id, "utf8").toString("hex")}_`;
}

/**
 * The Cookie header the remote should see: this machine's renamed cookies, renamed back —
 * and nothing else. Local cookies (the local session included) never leak to a remote;
 * another machine's cookies never leak across.
 */
export function rewriteRequestCookies(header: string | null, id: string): string | null {
  if (header === null) return null;
  const marker = cookieMarker(id);
  const kept: string[] = [];
  for (const part of header.split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(marker)) kept.push(cookie.slice(marker.length));
  }
  return kept.length > 0 ? kept.join("; ") : null;
}

/** A Set-Cookie from the remote, renamed into this machine's namespace on the local origin. */
export function rewriteSetCookie(header: string, id: string): string {
  const eq = header.indexOf("=");
  if (eq <= 0) return header;
  return `${cookieMarker(id)}${header}`;
}

/** An absolute-path Location from the remote, re-rooted under the proxy prefix. */
export function rewriteLocation(header: string, id: string): string {
  return header.startsWith("/")
    ? `${SERVER_PROXY_PREFIX}${encodeURIComponent(id)}${header}`
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
export function proxyToTunnel(request: Request, path: ProxyPath, port: number): Promise<Response> {
  return new Promise((resolve) => {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (!DROP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    });
    headers["host"] = `localhost:${port}`;
    const forwardedCookies = rewriteRequestCookies(request.headers.get("cookie"), path.id);
    if (forwardedCookies !== null) headers["cookie"] = forwardedCookies;

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
          out.append("set-cookie", rewriteSetCookie(cookie, path.id));
        }
        if (res.headers.location !== undefined) {
          out.set("location", rewriteLocation(res.headers.location, path.id));
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
              message: `The tunnel to ${path.id} did not answer: ${err.message}`,
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
  portFor: (id: string) => Promise<number | null>,
): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const path = parseProxyPath(new URL(request.url).pathname);
    if (path === null) return null;
    const port = await portFor(path.id);
    if (port === null) {
      return Response.json(
        {
          error: {
            code: "not_connected",
            message: `No live tunnel to ${path.id}; connect to it first.`,
          },
        },
        { status: 503 },
      );
    }
    return proxyToTunnel(request, path, port);
  };
}
