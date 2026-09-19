/**
 * Auth middleware: `Authorization: Bearer <local API token>` -> the built-in admin, or
 * session cookie -> auth_sessions row -> user; either way the user is injected into c.var.
 *
 * The Bearer path authenticates the boot's local API token (`<root>/api-token`, see
 * auth/api-token.ts) as the admin — the CLI's and agents' machine-local credential; it
 * applies to every route behind this middleware, SSE endpoints included (the CLI
 * consumes SSE via fetch with headers). A Bearer header that does not match fails the
 * request rather than falling back to the cookie: silently downgrading a wrong explicit
 * credential would mask misconfiguration.
 *
 * Accessing a protected API while logged out -> 401 `{error:{code:"unauthorized"}}`.
 * CSRF: SameSite=Lax plus a Content-Type an HTML form cannot forge (see jsonOnlyWrites).
 * That guard stays for Bearer requests too — the CLI always sends application/json.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
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
 * The name a BROWSER is given the cookie under: the port it reached this server on is part of
 * it. Cookies are scoped to a host and ignore the port, so two instances on one host — a
 * release and a development one, two tunnels on a phone — shared `penguin_session`, and
 * signing in to either signed the other out.
 *
 * Only a browser is given it. A non-browser client has a cookie jar of its own, and the CLI
 * reads the plain name off the login's Set-Cookie — an older CLI must keep finding it there.
 * The caller says which it is: a sign-in POST from a browser carries `Origin` and one from
 * anything else does not; the claim link is only ever followed by a browser. A Host without
 * a port keeps the plain name too.
 */
export function sessionCookieName(host: string | undefined, browser: boolean): string {
  const port = browser ? /:(\d{1,5})$/.exec(host ?? "")?.[1] : undefined;
  return port === undefined ? SESSION_COOKIE : `${SESSION_COOKIE}_${port}`;
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
  const port = /:(\d{1,5})$/.exec(host ?? "")?.[1];
  const names =
    port === undefined ? [SESSION_COOKIE] : [`${SESSION_COOKIE}_${port}`, SESSION_COOKIE];
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
 * addressed to: host AND port. No Origin at all is a non-browser client, which has no ambient
 * cookie to abuse. Shared by the write guard below and the terminal's WebSocket handshake.
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
  return parsed.host === (host ?? "");
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

export function authMiddleware(auth: Auth, trustProxy: boolean): MiddlewareHandler<AppEnv> {
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
    let held: { name: string; token: string } | undefined;
    let authed: ReturnType<Auth["authenticateWithMeta"]> = null;
    for (const cookie of sessionCookies(getCookie(c), c.req.header("host"))) {
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

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

export const jsonOnlyWrites: MiddlewareHandler = async (c, next) => {
  if (WRITE_METHODS.has(c.req.method)) {
    const contentType = c.req.header("content-type")?.toLowerCase();
    const hasBody =
      Number(c.req.header("content-length") ?? 0) > 0 ||
      c.req.header("transfer-encoding") !== undefined;
    const refused = contentType
      ? !ALLOWED_WRITE_CONTENT_TYPES.some((t) => contentType.startsWith(t))
      : hasBody;
    if (refused) {
      throw new HttpError(
        415,
        "unsupported_media_type",
        "Write requests only accept application/json (or, for the hot-update web push, a gzip artifact).",
      );
    }
  }
  await next();
};
