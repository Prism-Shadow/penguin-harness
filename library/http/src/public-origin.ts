/**
 * The public origin: the scheme, host and port in the browser's address bar when it reaches this
 * server. A URL handed back to that browser (a provider's OAuth callback, the address a Chrome
 * extension pairs with, the origin the API socket addresses its calls to) is built on it.
 *
 * Read off the request itself — the scheme of the connection that carried it and its `Host` —
 * unless the deployment trusts the forwarded headers (PENGUIN_TRUST_PROXY=1; the desktop app's
 * loopback-only server always does). Then `X-Forwarded-Proto` names the scheme and
 * `X-Forwarded-Host` the host, each only as one value: `http` or `https` (case and surrounding
 * whitespace aside), and one bare `host[:port]`. A list is not one value: a proxy that appends
 * instead of overwriting puts whatever the client sent first. A part that is not one value is
 * not trusted, and the request's own scheme or `Host` stands in for it.
 *
 * Untrusted, both headers are ignored outright: anyone who can reach the bind could otherwise
 * choose what a write's `Origin` is compared against, or where an authorization lands.
 *
 * The origin check (acceptsOrigin) reads less than that: the forwarded scheme with the request's
 * own `Host`. And where a trusted forwarded header is not one value it does not fall back to
 * anything; it refuses.
 */

/** The two forwarded headers, raw as the request carried them. */
export interface ForwardedHeaders {
  proto?: string | undefined;
  host?: string | undefined;
}

/** A request whose URL and headers can be read (a Hono context's `req`, or the same shape). */
interface RequestLike {
  req: { url: string; header(name: string): string | undefined };
}

/** Characters a single bare `host[:port]` never holds; a value with one names something else. */
const NOT_A_HOST = /[/\\?#@,\s]/;

/** A forwarded scheme as one value; `undefined` when the header is absent, `null` when it is anything else. */
function forwardedScheme(value: string | undefined): "http" | "https" | null | undefined {
  if (value === undefined) return undefined;
  const scheme = value.trim().toLowerCase();
  return scheme === "http" || scheme === "https" ? scheme : null;
}

/** A forwarded host as one value; `undefined` when the header is absent, `null` when it is anything else. */
function forwardedHost(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const host = value.trim();
  if (host === "" || NOT_A_HOST.test(host)) return null;
  try {
    new URL(`http://${host}`);
    return host;
  } catch {
    // Not a host the URL parser accepts (a bad port, say).
    return null;
  }
}

export function publicOrigin(
  requestUrl: string | URL,
  forwarded: ForwardedHeaders,
  trustProxy: boolean,
): string {
  const own = new URL(requestUrl);
  if (!trustProxy) return own.origin;
  const scheme = forwardedScheme(forwarded.proto) ?? own.protocol.slice(0, -1);
  const host = forwardedHost(forwarded.host) ?? own.host;
  return new URL(`${scheme}://${host}`).origin;
}

/** The forwarded headers of a request. */
export function forwardedHeaders(c: RequestLike): ForwardedHeaders {
  return { proto: c.req.header("x-forwarded-proto"), host: c.req.header("x-forwarded-host") };
}

/** {@link publicOrigin} of a request. */
export function publicOriginOf(c: RequestLike, trustProxy: boolean): string {
  return publicOrigin(c.req.url, forwardedHeaders(c), trustProxy);
}

/** Scheme, host and port must agree; absent Origin retains the non-browser contract. */
export function isOwnOrigin(origin: string | undefined, requestUrl: URL): boolean {
  if (!origin) return true;
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") return false;
  try {
    const source = new URL(origin);
    return (
      (source.protocol === "http:" || source.protocol === "https:") &&
      source.origin === requestUrl.origin
    );
  } catch {
    return false;
  }
}

/** What a deployment's origin check accepts besides an absent `Origin`. */
export interface OriginRule {
  /** PENGUIN_TRUST_PROXY=1: `X-Forwarded-Proto` names the scheme the browser is on. */
  trustProxy: boolean;
  /**
   * Also accept the request's own origin, the connection's scheme with its `Host`, whatever the
   * forwarded headers say. A transition, for the desktop alone: a desktop server from before
   * the public origin trusts no proxy and compares `Origin` with the request's own origin, so a
   * hop of the Penguin Remote relay (today its client, on the user's machine) rewrites the
   * browser's `https://` Origin to `http://` when it names the tunnel's own host, and this keeps
   * a newer desktop working behind that rewrite. Nowhere else: behind a TLS-terminating proxy it
   * would admit `http://` on the public host, a page that an on-path attacker can serve, and a
   * browser without schemeful SameSite sends the https cookie along with a WebSocket handshake or
   * a body-less write from it, neither of which waits for a preflight. Before 0.3.0 the client
   * stops rewriting `Origin` and sets `X-Forwarded-Proto` and `X-Forwarded-Host` instead; the
   * flag is deleted in 0.3.0.
   */
  acceptOwnOrigin: boolean;
}

/**
 * The rule a server's config sets: only desktop mode (a desktop token) takes the transition. A
 * config that names no token at all is no desktop either.
 */
export function originRule(config: {
  trustProxy: boolean;
  desktopToken: string | null;
}): OriginRule {
  return { trustProxy: config.trustProxy, acceptOwnOrigin: Boolean(config.desktopToken) };
}

/** Neither a trusted proxy nor the desktop: `Origin` must be the request's own. */
export const NO_PROXY_RULE: OriginRule = { trustProxy: false, acceptOwnOrigin: false };

/**
 * Whether a request's `Origin` names this App: absent (not a browser's request), or the origin
 * the request was addressed to — the scheme, forwarded when the proxy is trusted, with the
 * request's own `Host`. `X-Forwarded-Host` has no say here: a proxy that keeps `Host` may pass a
 * client's `X-Forwarded-Host` through unchanged, which would let the client pick the origin it
 * is compared with. A trusted forwarded header that is not one value fails the check outright.
 * Desktop mode also takes the request's own origin (OriginRule.acceptOwnOrigin).
 */
export function acceptsOrigin(
  origin: string | undefined,
  requestUrl: string | URL,
  forwarded: ForwardedHeaders,
  rule: OriginRule,
): boolean {
  if (!origin) return true;
  const own = new URL(requestUrl);
  if (rule.acceptOwnOrigin && isOwnOrigin(origin, own)) return true;
  if (!rule.trustProxy) return isOwnOrigin(origin, own);
  const scheme = forwardedScheme(forwarded.proto);
  if (scheme === null || forwardedHost(forwarded.host) === null) return false;
  return isOwnOrigin(origin, new URL(`${scheme ?? own.protocol.slice(0, -1)}://${own.host}`));
}

/**
 * The browser's own account of where a request came from: `Sec-Fetch-Site`, which no page can
 * set. When a request carries it, it must say `same-origin`, whatever its `Origin` says; one
 * without it (an older browser, or no browser at all) is left to the `Origin` check.
 */
export function sameOriginSite(site: string | undefined): boolean {
  return site === undefined || site === "same-origin";
}
