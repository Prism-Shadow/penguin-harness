/**
 * Auth middleware: `Authorization: Bearer <local API token>` -> the built-in admin, or
 * session cookie -> auth_sessions row -> user; either way the user is injected into c.var.
 *
 * The Bearer path authenticates the boot's local API token (`<root>/api-token`, see
 * auth/api-token.ts) as the admin — the CLI's and agents' machine-local credential; it
 * applies to every route behind this middleware, SSE endpoints included (the CLI
 * consumes SSE via fetch with headers). A Bearer header that does not match fails the
 * request rather than falling back to the cookie: silently downgrading a wrong explicit
 * credential would mask misconfiguration. A few writes refuse the token all the same and take a
 * person's sign-in (requireHuman).
 *
 * Accessing a protected API while logged out -> 401 `{error:{code:"unauthorized"}}`.
 * CSRF: SameSite=Lax plus a Content-Type an HTML form cannot forge (see jsonOnlyWrites).
 * That guard stays for Bearer requests too — the CLI always sends application/json.
 */
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { AMSP_PREFIX } from "../amsp/cors.js";
import { HttpError } from "../http/errors.js";
import type { UserRow } from "../db/repos/users.js";
import type { SessionVia } from "./service.js";
import type { Auth } from "../mechanisms/identity.js";

/**
 * The session cookie's name as every non-browser client spells it: the CLI, and a server
 * speaking to a machine it holds, each with a cookie jar of its own.
 */
export const SESSION_COOKIE = "penguin_session";

/**
 * A host authority — a `Host` header's, or an `Origin` URL's — reduced to what every check on
 * this page reads: the host lowercased, since a domain name is case-insensitive, and the port
 * as written (null when it is not).
 */
interface Authority {
  host: string;
  port: string | null;
}

/** The port an http(s) scheme is reached on when a URL or a Host leaves it out. */
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

/** The authority a `Host` header names: `example.com:7364`, `[::1]:7364`, `example.com`. */
function authorityOfHost(host: string | undefined): Authority | null {
  const raw = (host ?? "").trim();
  if (raw === "") return null;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(raw);
  if (m === null) return null;
  return { host: m[1]!.toLowerCase(), port: m[2] ?? null };
}

/**
 * The port a BROWSER's cookie name carries. Cookies are scoped to a host and ignore the port,
 * so two instances on one host — a release and a development one, two tunnels on a phone —
 * shared `penguin_session`, and signing in to either signed the other out. A port the scheme
 * uses by default (`:80`, `:443`) is the one a browser does not write down, so a Host that
 * spells it out still gets the plain name: the sign-in and the request that follows it must
 * look for the same cookie.
 */
function cookieNamePort(host: string | undefined): string | null {
  const port = authorityOfHost(host)?.port ?? null;
  return port === "80" || port === "443" ? null : port;
}

/**
 * The name a BROWSER is given the cookie under: the port it reached this server on is part of
 * it (see {@link cookieNamePort}).
 *
 * Only a browser is given it. A non-browser client has a cookie jar of its own, and the CLI
 * reads the plain name off the login's Set-Cookie — an older CLI must keep finding it there.
 * The caller says which it is: a sign-in POST from a browser carries `Origin` and one from
 * anything else does not; the claim link is only ever followed by a browser. A Host without
 * a port keeps the plain name too.
 */
export function sessionCookieName(host: string | undefined, browser: boolean): string {
  const port = browser ? cookieNamePort(host) : null;
  return port === null ? SESSION_COOKIE : `${SESSION_COOKIE}_${port}`;
}

/**
 * The session cookies a request carries, this origin's own name first, then the plain one —
 * what a non-browser client sends, and what a browser still holds from a sign-in made before
 * the name carried the port. A token that is another instance's authenticates nobody.
 */
export function sessionCookies(
  cookies: Record<string, string | undefined>,
  host: string | undefined,
): { name: string; token: string }[] {
  const port = cookieNamePort(host);
  const names = port === null ? [SESSION_COOKIE] : [`${SESSION_COOKIE}_${port}`, SESSION_COOKIE];
  return names.flatMap((name) => {
    const token = cookies[name];
    return token ? [{ name, token }] : [];
  });
}

/** A raw Cookie header as name → value; a malformed escape is an absent cookie, never a throw. */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    try {
      out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // An invalid credential, not a server error.
    }
  }
  return out;
}

/**
 * Whether a request a browser labelled with `origin` was made by a page of the origin it is
 * addressed to: host AND port, normalized — a domain's case and a scheme's default port name
 * the same address, so `http://example.com` against `Host: example.com:80` is the same origin
 * and a domain spelled in another case is too. No Origin at all is a non-browser client, which
 * has no ambient cookie to abuse. Shared by the write guard below and the terminal's WebSocket
 * handshake.
 */
export function isOwnOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const own = authorityOfHost(host);
  if (own === null) return false;
  // `URL` drops the scheme's own default port from `port`, so a Host that writes it out is the
  // same address. A Host with no port is the one a browser leaves implicit: it names the
  // scheme's default and nothing else, so an Origin that spells a port is another origin — the
  // question the raw host:port comparison asked before, which a default-port deployment must
  // keep asking (`Host: example.com` does not admit `http://example.com:8443`).
  const port = parsed.port === "" ? DEFAULT_PORTS[parsed.protocol]! : parsed.port;
  return (
    parsed.hostname.toLowerCase() === own.host &&
    (own.port === null ? parsed.port === "" : own.port === port)
  );
}

/**
 * Session cookie attributes, shared by every path that sets one. `maxAge` comes from the
 * service that issues the sessions, never written here: the ROW carries the authoritative
 * expiry, and a cookie that expired first would log someone out mid-session.
 */
export function cookieOptions(
  c: { req: { url: string; header(name: string): string | undefined } },
  ttlMs: number,
  trustProxy: boolean,
) {
  // `x-forwarded-proto` is caller-supplied and untrusted unless the deployment opts in
  // (config.trustProxy — the same gate hmr/routes.ts uses, and for the same reason). Trusting
  // it on a plain-HTTP bind would let anyone reaching the port get a Secure cookie back, which
  // the browser then refuses to send over that connection: a sign-in that never takes.
  const proto = trustProxy
    ? (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", ""))
    : new URL(c.req.url).protocol.replace(":", "");
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
    ...(proto === "https" ? { secure: true } : {}),
  };
}

/** Hono env: variables injected by the auth middleware. */
export type AppEnv = {
  Variables: {
    user: UserRow;
    /** How the current session was established — see {@link SessionVia}. */
    sessionVia: SessionVia;
  };
};

/** Gets the current user (available after authMiddleware). */
export function currentUser(c: { var: { user: UserRow } }): UserRow {
  return c.var.user;
}

export function authMiddleware(
  auth: Auth,
  trustProxy: boolean,
  options: { apiTokenOnly?: boolean } = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // Bearer first: an explicit credential on the request outranks ambient cookies, and
    // a wrong one is an error, never a silent fallback (see the module doc).
    const bearer = bearerToken(c.req.header("authorization"));
    if (bearer !== null) {
      const viaToken = auth.authenticateApiToken(bearer);
      if (!viaToken) {
        throw new HttpError(401, "unauthorized", "Invalid API token.");
      }
      c.set("user", viaToken.user);
      c.set("sessionVia", viaToken.via);
      await next();
      return;
    }
    const cookies = sessionCookies(getCookie(c), c.req.header("host"));
    // Classify a refused cookie without renewing its session or setting a response cookie.
    if (options.apiTokenOnly) {
      if (cookies.some((cookie) => auth.sessionIsLive(cookie.token))) {
        throw new HttpError(
          403,
          "local_api_token_required",
          "Only the local API token may issue a remote browser session.",
        );
      }
      throw new HttpError(401, "unauthorized", "Not signed in or the sign-in has expired.");
    }
    let held: { name: string; token: string } | undefined;
    let authed: ReturnType<Auth["authenticateWithMeta"]> = null;
    for (const cookie of cookies) {
      authed = auth.authenticateWithMeta(cookie.token);
      if (authed) {
        held = cookie;
        break;
      }
    }
    if (!authed) {
      throw new HttpError(401, "unauthorized", "Not signed in or the sign-in has expired.");
    }
    // Sliding renewal: the session's expiry was topped up in place, so refresh the cookie's
    // own max-age to match. The token value is unchanged — same session, longer life.
    if (authed.renewed && held) {
      // Under the name it arrived under: a renewal is the same cookie, longer-lived.
      setCookie(c, held.name, held.token, cookieOptions(c, auth.sessionTtlMs, trustProxy));
    }
    c.set("user", authed.user);
    c.set("sessionVia", authed.via);
    await next();
  };
}

/** The token of an `Authorization: Bearer <token>` header (scheme matched case-insensitively); null for any other shape. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m === null ? null : m[1]!.trim();
}

/**
 * Refuses the local API token and its exchanged Remote cookies on a write that only a person
 * may make: 403 `human_required`. AuthService preserves their common "token" authority. A
 * person's sign-in — a cookie session, from the Web App, `penguin auth login` or
 * `penguin auth token` — passes. Every tool subprocess of a server-driven Session holds that token
 * as `PENGUIN_API_TOKEN`, so these are the writes an Agent must not make from its own shell:
 *
 * - who can reach an Agent from outside — its API switch, keyless access and approval mode, its
 *   keys, the API tab's Try it, and the admin's `agentApiEnabled` (http/routes/agent-api.ts,
 *   amsp/try-route.ts, http/routes/admin-settings.ts);
 * - the person's own browser — choosing the agent browser's backend, minting a pairing code
 *   (builtin-browser/routes.ts).
 *
 * This narrows the credential the harness hands an Agent; it is not a boundary. A process that
 * runs as the data root's OS user outside the sandbox can mint a sign-in of its own
 * (`penguin auth token`), or reset a password with the token and sign in. The sandbox is the
 * boundary. A per-Session credential (design PR #235) is the structural fix: when it lands, this
 * check becomes "a Session's credential is refused, a person's login is not", and the routes
 * calling it do not change.
 */
export function requireHuman(c: { var: { sessionVia: SessionVia } }): void {
  if (c.var.sessionVia === "token") {
    throw new HttpError(
      403,
      "human_required",
      "Sign in with your password to do this; an API token or its Remote session cannot.",
    );
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Writes that are cross-origin by design and judge their caller's origin themselves, so the
 * same-origin rule below is not theirs. POST /api/builtin-browser/extension/pair is the
 * PenguinHarness Browser extension calling from its `chrome-extension://` origin: it reads no
 * cookie (the pairing code is the credential) and admits only the extension's own origin,
 * refusing a web page's 403 (builtin-browser/routes.ts, extensionPairRoutes).
 */
const OWN_ORIGIN_RULE_PATHS = new Set(["/api/builtin-browser/extension/pair"]);

/**
 * The Agent API's writes are cross-origin by contract, and its own group is what judges them.
 * `/api/amsp/v1` answers a preflight from any origin and sends `Access-Control-Allow-Origin: *`
 * on a request that carries `Authorization` (amsp/cors.ts; the server-api page states it as the
 * public contract), so a program outside PenguinHarness calls it from a page of its own. The
 * credential there is the Agent's key as a Bearer, never this app's cookie: the group's gate
 * checks the key and a cookie falls through to its 401 (amsp/gate.ts). Hence the one exception
 * below — inside the exact prefix boundary and with a parseable Bearer — while a cookie-bearing
 * or credential-less write is still held to the same-origin rule.
 */
function isAmspKeyedWrite(c: Context): boolean {
  const path = c.req.path;
  if (path !== AMSP_PREFIX && !path.startsWith(`${AMSP_PREFIX}/`)) return false;
  return bearerToken(c.req.header("authorization")) !== null;
}

/**
 * CSRF defense, first line: a write a browser makes must come from a page of THIS origin. The
 * browser states the origin itself (`Origin` rides on every POST, PUT, PATCH and DELETE, and a
 * page cannot forge it), so this asks the question directly — where the content-type rule
 * below only asks what a cross-site form is able to send. Host AND port: cookies ignore the
 * port, so `SameSite` lets a page served by any other local server ride the session.
 */
export const sameOriginWrites: MiddlewareHandler = async (c, next) => {
  if (
    WRITE_METHODS.has(c.req.method) &&
    !OWN_ORIGIN_RULE_PATHS.has(c.req.path.replace(/\/+$/, "")) &&
    !isAmspKeyedWrite(c) &&
    !isOwnOrigin(c.req.header("origin"), c.req.header("host"))
  ) {
    throw new HttpError(403, "cross_origin_write", "A write must come from this app's own pages.");
  }
  await next();
};

/**
 * CSRF defense, second line: a write must carry one of these Content-Types, none of which an
 * HTML form can forge (a form is limited to x-www-form-urlencoded, multipart/form-data,
 * text/plain). json is the API default; gzip and octet-stream are the hot-update web push's
 * artifact transport (src/hmr). A write with no Content-Type is let through only when it has
 * no body either: a page can send a body with no type at all (`fetch` with an untyped Blob,
 * `mode: "no-cors"`), and the handlers parse JSON without asking what it was labelled.
 */
const ALLOWED_WRITE_CONTENT_TYPES = [
  "application/json",
  "application/gzip",
  "application/octet-stream",
];

/**
 * A workbench's own handler (`…/workbenches/:id/api/*`) takes any body — an upload, a form of a
 * program it relays — so there the content type cannot be the defense. What stands in for it
 * is the browser's own account of where the request came from, which a page cannot forge:
 * `Sec-Fetch-Site`, and `Origin` against `Host` for a browser that sends no fetch metadata.
 * A request with neither is not a browser's, and carries no ambient cookie to ride on.
 * A write there is covered by `sameOriginWrites` above; this is what stands in for the
 * content-type rule, and what guards the handler's reads.
 */
const WORKBENCH_API = /^\/api\/projects\/[^/]+\/agents\/[^/]+\/workbenches\/[^/]+\/api(\/|$)/;

function fromThisOrigin(header: (name: string) => string | undefined): boolean {
  const site = header("sec-fetch-site");
  if (site !== undefined) return site === "same-origin";
  return isOwnOrigin(header("origin"), header("host"));
}

const crossOrigin = () =>
  new HttpError(
    403,
    "cross_origin_write",
    "A request to a workbench's handler must come from this app's own pages.",
  );

export const jsonOnlyWrites: MiddlewareHandler = async (c, next) => {
  // A workbench's handler answers every method, so its GET is whatever the workbench made it
  // — not the read every other route's GET is. A `SameSite=Lax` cookie rides along on a
  // cross-site top-level navigation, so `window.open` on another site would otherwise run
  // that handler as the signed-in user; the browser's own account of where the request came
  // from is what settles it, on every method rather than only on writes.
  if (!WRITE_METHODS.has(c.req.method) && WORKBENCH_API.test(c.req.path)) {
    if (!fromThisOrigin((name) => c.req.header(name))) throw crossOrigin();
  }
  if (WRITE_METHODS.has(c.req.method)) {
    const contentType = c.req.header("content-type")?.toLowerCase();
    const forgeable =
      contentType !== undefined &&
      contentType !== "" &&
      !ALLOWED_WRITE_CONTENT_TYPES.some((t) => contentType.startsWith(t));
    const hasBody =
      Number(c.req.header("content-length") ?? 0) > 0 ||
      c.req.header("transfer-encoding") !== undefined;
    // A workbench's own handler takes any body; the origin rule is its whole defense there.
    if (WORKBENCH_API.test(c.req.path)) {
      if (forgeable && !fromThisOrigin((name) => c.req.header(name))) throw crossOrigin();
    } else if (contentType ? forgeable : hasBody) {
      throw new HttpError(
        415,
        "unsupported_media_type",
        "Write requests only accept application/json (or, for the hot-update web push, a gzip artifact).",
      );
    }
  }
  await next();
};
