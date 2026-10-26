/**
 * The public origin: the scheme, host and port in the browser's address bar when it reaches this
 * server. A URL handed back to that browser (a provider's OAuth callback, the address a Chrome
 * extension pairs with) is built on it, and a page of this App sends it as `Origin`.
 *
 * Read off the request itself — the scheme of the connection that carried it and its `Host` —
 * unless the deployment trusts the forwarded headers (PENGUIN_TRUST_PROXY=1; the desktop app's
 * loopback-only server always does). Then `X-Forwarded-Proto` names the scheme and
 * `X-Forwarded-Host` the host, the first value of each: proxies in a chain append, and the first
 * value is the one the proxy facing the browser wrote, provided that proxy overwrites what the
 * client sent. A value that names no scheme or no bare host is ignored, and the request's own
 * scheme or `Host` stands in for it.
 *
 * Untrusted, both headers are ignored outright: anyone who can reach the bind could otherwise
 * choose what a write's `Origin` is compared against, or where an authorization lands.
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

/** Characters a bare `host[:port]` never holds; a forwarded value with one names something else. */
const NOT_A_HOST = /[/\\?#@\s]/;

const firstValue = (value: string | undefined): string | undefined => {
  const first = value?.split(",")[0]?.trim();
  return first === undefined || first === "" ? undefined : first;
};

export function publicOrigin(
  requestUrl: string | URL,
  forwarded: ForwardedHeaders,
  trustProxy: boolean,
): string {
  const own = new URL(requestUrl);
  if (!trustProxy) return own.origin;
  const proto = firstValue(forwarded.proto)?.toLowerCase();
  const scheme = proto === "http" || proto === "https" ? proto : own.protocol.slice(0, -1);
  const host = firstValue(forwarded.host);
  if (host !== undefined && !NOT_A_HOST.test(host)) {
    try {
      return new URL(`${scheme}://${host}`).origin;
    } catch {
      // Not a host the URL parser accepts (a bad port, say): the request's own Host stands in.
    }
  }
  return new URL(`${scheme}://${own.host}`).origin;
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

/**
 * Whether a request's `Origin` names this App: absent (not a browser's request), the public
 * origin, or the request's own origin — the connection's scheme with its `Host`.
 *
 * The second is a transition. A desktop server from before this rule trusts no proxy and compares
 * `Origin` with the request's own origin, so a hop of the Penguin Remote relay — today its client,
 * the proxy on the user's machine — rewrites the browser's `https://` Origin to `http://` when it
 * names the tunnel's own host, or no write would pass. Accepting the request's own origin keeps a
 * server with the rule working behind that rewrite. With no trusted proxy the two origins are the
 * same; behind one, the extra origin names the very host the request was addressed to, only under
 * the connection's own scheme. Before 0.3.0 the client stops rewriting `Origin` and sets
 * `X-Forwarded-Proto` and `X-Forwarded-Host` instead; the second clause is deleted in 0.3.0.
 */
export function acceptsOrigin(
  origin: string | undefined,
  requestUrl: string | URL,
  forwarded: ForwardedHeaders,
  trustProxy: boolean,
): boolean {
  if (!origin) return true;
  const own = new URL(requestUrl);
  return (
    isOwnOrigin(origin, new URL(publicOrigin(own, forwarded, trustProxy))) ||
    isOwnOrigin(origin, own)
  );
}
