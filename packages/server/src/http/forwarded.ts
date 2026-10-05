/**
 * Where the browser addressed a request: scheme, host and path prefix, as opposed to where it
 * arrived. The two differ behind a reverse proxy (PENGUIN_TRUST_PROXY=1), and on a machine
 * reached through a hub's same-origin proxy (`/server/<machineId>/api/…`, machines/proxy.ts),
 * which dials the machine's loopback and names it `localhost:<port>`.
 *
 * The `x-forwarded-*` headers that carry the difference are caller-supplied, so they are read
 * only when the caller says they may be trusted, and even then only in a shape a URL can take:
 * a host of hostname characters and an optional port, a scheme of http or https, and a prefix
 * of plain path segments. Anything else falls back to the request's own URL.
 */

/** The forwarded facts a request carries, raw (each possibly a comma-joined chain). */
export interface ForwardedHeaders {
  proto?: string;
  host?: string;
  prefix?: string;
}

/** The three headers, read off a request; absent ones are left out. */
export function forwardedHeaders(
  get: (name: string) => string | null | undefined,
): ForwardedHeaders {
  const proto = get("x-forwarded-proto");
  const host = get("x-forwarded-host");
  const prefix = get("x-forwarded-prefix");
  return {
    ...(proto !== null && proto !== undefined ? { proto } : {}),
    ...(host !== null && host !== undefined ? { host } : {}),
    ...(prefix !== null && prefix !== undefined ? { prefix } : {}),
  };
}

/** A chain of proxies appends to these headers; the client-facing hop is the first value. */
const firstHop = (value: string | undefined): string | undefined => {
  const hop = value?.split(",")[0]?.trim();
  return hop === undefined || hop === "" ? undefined : hop;
};

/** A hostname (DNS name, IPv4, or bracketed IPv6) with an optional port — nothing a URL would reinterpret. */
const HOST_RE = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
/** Path segments of unreserved characters (percent-escapes allowed), no trailing slash. */
const PREFIX_RE = /^(?:\/[A-Za-z0-9._~%-]+)+$/;
const PREFIX_MAX = 512;

/**
 * The path prefix the browser addressed this server under, or "" — validated so it can only
 * add path segments: no `..`, no empty segment (which would start a protocol-relative URL),
 * no query or fragment.
 */
export function forwardedPrefix(headers: ForwardedHeaders, trusted: boolean): string {
  if (!trusted) return "";
  const prefix = firstHop(headers.prefix)?.replace(/\/+$/, "");
  if (prefix === undefined || prefix === "" || prefix.length > PREFIX_MAX) return "";
  if (!PREFIX_RE.test(prefix)) return "";
  if (prefix.split("/").some((segment) => segment === "." || segment === "..")) return "";
  return prefix;
}

/**
 * The origin the browser addressed: the request's own URL, or — when trusted — the forwarded
 * scheme and host in its place, each one falling back on its own when absent or malformed.
 */
export function clientOrigin(url: string, headers: ForwardedHeaders, trusted: boolean): string {
  const own = new URL(url);
  if (!trusted) return own.origin;
  const proto = firstHop(headers.proto);
  const host = firstHop(headers.host);
  const scheme = proto === "http" || proto === "https" ? proto : own.protocol.replace(":", "");
  return `${scheme}://${host !== undefined && HOST_RE.test(host) ? host : own.host}`;
}
