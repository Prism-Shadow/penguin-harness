/**
 * The platform's WebSocket endpoints (`HttpModule.upgrades`): which one an upgrade goes to, and
 * — for an endpoint declared `auth: "user"` — the signed-in person it goes with.
 *
 * - **Matching**: the endpoint whose prefix covers the path most specifically
 *   (http/route-prefix.ts; `:name` segments match any one segment). A prefix with any other
 *   pattern form cannot be matched exactly, so that endpoint is not served: it is named in the
 *   log when the generation is assembled, and its upgrades go on as if it were not there.
 * - **`auth: "user"`**: the host checks the handshake as the runtime checks the API socket's
 *   (terminal/ws.ts). A WebSocket handshake is not subject to CORS, so a browser's `Origin`
 *   must be this app's own and its `Sec-Fetch-Site`, when sent, `same-origin` — 403 otherwise —
 *   and the session cookie must name a live sign-in — 401 otherwise. Both are answered before
 *   the endpoint sees anything; it then gets the user and how their session was established.
 *   The cookie is the credential (a browser cannot set headers on a WebSocket), not the API
 *   token.
 * - **`auth: "none"`**: the endpoint gets the request as it came, with no caller. It owns its
 *   credential (the browser extension's token rides in the subprotocol) and must check the
 *   `Origin` itself: a cookie rides along on any page's handshake, so an endpoint that trusted
 *   one without that check would let any site the user visits open it (cross-site WebSocket
 *   hijacking).
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";
import { format } from "node:url";
import type { Auth, SessionVia } from "@prismshadow/penguin-library-auth";
import type { UserRow } from "@prismshadow/penguin-library-auth/repos/users";
import { parseCookieHeader, sessionCookies } from "../auth/middleware.js";
import { acceptsOrigin, sameOriginSite } from "./public-origin.js";
import type { OriginRule } from "./public-origin.js";
import { mostSpecific, prefixPatternProblem } from "./route-prefix.js";

/** Who a `user` endpoint's socket belongs to: the signed-in user, as a route's `c.var` names them. */
export interface UpgradeCaller {
  user: UserRow;
  sessionVia: SessionVia;
}

/**
 * A WebSocket endpoint's code half: it receives the upgrade request untouched — nothing has
 * answered or read it — and owns the handshake from there. It refuses by writing a status line
 * and destroying the socket, or upgrades it (with `ws`'s `handleUpgrade`, say) and holds the
 * connection from then on. `caller` is the signed-in user for an `auth: "user"` endpoint, null
 * for an `auth: "none"` one. The connection belongs to the generation that contributed the
 * endpoint: its module closes it on dispose (1012), and the client reconnects to the next one.
 */
export interface WebSocketUpgrade {
  upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    caller: UpgradeCaller | null,
  ): void;
}

export interface UpgradeEndpoint {
  id: string;
  prefix: string;
  auth: "none" | "user";
  code: WebSocketUpgrade;
}

export interface UpgradeDispatchDeps {
  auth: Auth;
  rule: OriginRule;
  log(line: string): void;
}

/** Hands an upgrade to its endpoint and answers true; false when no endpoint covers the path. */
export function upgradeDispatch(
  endpoints: readonly UpgradeEndpoint[],
  deps: UpgradeDispatchDeps,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => boolean {
  const served = endpoints
    .filter((endpoint) => {
      const problem = prefixPatternProblem(endpoint.prefix);
      if (problem === null) return true;
      deps.log(
        `[http] WebSocket endpoint '${endpoint.id}' is not served: its prefix '${endpoint.prefix}' has ${problem}`,
      );
      return false;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const endpoint = mostSpecific(served, path)[0];
    if (endpoint === undefined) return false;
    if (endpoint.auth === "none") {
      endpoint.code.upgrade(request, socket, head, null);
      return true;
    }
    const checked = signedIn(request, path, deps);
    if ("status" in checked) refuse(socket, checked.status, checked.text);
    else endpoint.code.upgrade(request, socket, head, checked.caller);
    return true;
  };
}

/** The handshake's Origin and session cookie, checked as the runtime checks the API socket's. */
function signedIn(
  request: IncomingMessage,
  path: string,
  deps: UpgradeDispatchDeps,
): { caller: UpgradeCaller } | { status: number; text: string } {
  const forbidden = { status: 403, text: "Forbidden" };
  const header = (name: string): string | undefined => {
    const value = request.headers[name];
    return Array.isArray(value) ? value.join(",") : value;
  };
  let target: URL;
  try {
    if (!request.headers.host) return forbidden;
    const protocol =
      request.socket instanceof TLSSocket && request.socket.encrypted ? "https:" : "http:";
    target = new URL(
      format({ protocol, host: request.headers.host, pathname: path, slashes: true }),
    );
    const forwarded = { proto: header("x-forwarded-proto"), host: header("x-forwarded-host") };
    if (
      !sameOriginSite(header("sec-fetch-site")) ||
      !acceptsOrigin(request.headers.origin, target, forwarded, deps.rule)
    ) {
      return forbidden;
    }
  } catch {
    return forbidden;
  }
  const authed =
    sessionCookies(parseCookieHeader(request.headers.cookie), target)
      .map(({ token }) => deps.auth.authenticateWithMeta(token))
      .find((a) => a !== null) ?? null;
  if (authed === null) return { status: 401, text: "Unauthorized" };
  return { caller: { user: authed.user, sessionVia: authed.via } };
}

function refuse(socket: Duplex, status: number, text: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
