/**
 * The same-origin server proxy: `/server/<machineId>/api/…` on THIS server forwards to that
 * machine's server through the forward held to it.
 *
 * Addressed by the machine's OWN id, not the ssh alias it was reached through: an alias is a
 * line in one config file, and renaming it would change every URL below. Only `/api/` paths
 * are forwarded — the frontend stays local and re-points its API calls by prefix.
 *
 * ONE IDENTITY. The caller is this server's admin, and this server's admin is that
 * machine's admin: the ssh access that installed the program there is what authorizes it,
 * and the session presented to the machine is one this server mints over that access
 * (remote-token.ts). The browser's own cookies never travel, and the machine's never come
 * back — so this mounts INSIDE this server's auth middleware, for admins.
 */
import http from "node:http";
import { Readable } from "node:stream";

/** Path prefix of the proxy: `/server/<id>/api/…`. */
export const SERVER_PROXY_PREFIX = "/server/";

/** A parsed proxy path: which machine, and the remote-side path to request. */
interface ProxyPath {
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

/** An absolute-path Location from the remote, re-rooted under the proxy prefix. */
export function rewriteLocation(header: string, machineId: string): string {
  return header.startsWith("/")
    ? `${SERVER_PROXY_PREFIX}${encodeURIComponent(machineId)}${header}`
    : header;
}

/** Hop-by-hop and identity headers that must not cross. */
const DROP_REQUEST_HEADERS = new Set(["host", "cookie", "connection", "keep-alive", "upgrade"]);
const DROP_RESPONSE_HEADERS = new Set(["set-cookie", "location", "connection", "keep-alive"]);

/**
 * Forwards one request to the machine's forward port and streams the answer back — both
 * directions are pipes, so SSE and long downloads flow as they arrive. node:http rather
 * than fetch: the Host header must be the canonical app host (`localhost:<port>`) while the
 * connection goes to 127.0.0.1, and fetch ignores an explicit host header.
 */
function proxyToTunnel(
  request: Request,
  path: ProxyPath,
  port: number,
  cookie: string,
): Promise<Response> {
  return new Promise((resolve) => {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (!DROP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    });
    headers["host"] = `localhost:${port}`;
    headers["cookie"] = cookie;

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
              message: `The forward to ${path.machineId} did not answer: ${err.message}`,
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
 * The seam handler: `/server/<id>/api/…` → that machine, or a clear answer when there is
 * nothing to forward to. `resolve` is the machines service's lookup: the forward's port and
 * a session on that machine, or null when it is not connected.
 */
export function machinesProxy(
  resolve: (machineId: string) => Promise<{ port: number; cookie: string } | null>,
): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const path = parseProxyPath(new URL(request.url).pathname);
    if (path === null) return null;
    const target = await resolve(path.machineId);
    if (target === null) {
      return Response.json(
        {
          error: {
            code: "not_connected",
            message: `No live forward to ${path.machineId}; connect to it first.`,
          },
        },
        { status: 503 },
      );
    }
    return proxyToTunnel(request, path, target.port, target.cookie);
  };
}
