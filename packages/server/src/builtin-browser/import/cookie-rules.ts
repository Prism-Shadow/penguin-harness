/**
 * The rules every imported cookie passes, whichever browser it came from: the `domains`
 * filter, and the shape the shell's `set-cookies` takes (Electron's CookiesSetDetails).
 */
import type { DesktopBrowserCookie } from "../../api/types.js";

export type SameSite = NonNullable<DesktopBrowserCookie["sameSite"]>;

/** A cookie as read from a store, before it is shaped for the shell. */
export interface StoredCookie {
  /** The store's host: a leading dot marks a domain cookie, none a host-only one. */
  host: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Unix seconds; 0 = a session cookie. */
  expires: number;
  sameSite: SameSite;
}

/**
 * The `domains` option as bare lowercase hosts: a pasted URL keeps its host, and leading or
 * trailing dots go. Empty entries are dropped, so an empty list means "every site".
 */
export function normalizeDomains(domains: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of domains ?? []) {
    let host = raw.trim().toLowerCase();
    if (host.includes("://")) {
      try {
        host = new URL(host).hostname;
      } catch {
        continue;
      }
    }
    host = host.replace(/^\.+|\.+$/g, "");
    if (host !== "") out.add(host);
  }
  return [...out];
}

/**
 * Whether a cookie belongs to one of `domains`: its host is a domain or lies under it
 * (`amazon.com` keeps `.amazon.com` and `www.amazon.com`, never `notamazon.com`). A domain
 * cookie also counts when a requested site lies under it — `.amazon.com` is sent to
 * `www.amazon.com`, so asking for that site's sign-in has to bring it along.
 */
export function inDomains(host: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true;
  const bare = host.toLowerCase().replace(/^\./, "");
  return domains.some(
    (domain) =>
      bare === domain ||
      bare.endsWith(`.${domain}`) ||
      (host.startsWith(".") && domain.endsWith(`.${bare}`)),
  );
}

export function isExpired(cookie: StoredCookie, nowSeconds: number): boolean {
  return cookie.expires > 0 && cookie.expires <= nowSeconds;
}

/**
 * The shell's cookie: the URL it is set for, and `domain` only for a domain cookie — giving a
 * host-only cookie a domain would widen it to every subdomain. SameSite=None is only valid on
 * a secure cookie, so an insecure one falls back to the browser default.
 */
export function toDesktopCookie(cookie: StoredCookie): DesktopBrowserCookie {
  const host = cookie.host.replace(/^\./, "");
  const cookiePath = cookie.path.startsWith("/") ? cookie.path : `/${cookie.path}`;
  const sameSite =
    cookie.sameSite === "no_restriction" && !cookie.secure ? "unspecified" : cookie.sameSite;
  return {
    url: `${cookie.secure ? "https" : "http"}://${host}${cookiePath}`,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.host.startsWith(".") ? { domain: cookie.host } : {}),
    path: cookiePath,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.expires > 0 ? { expirationDate: cookie.expires } : {}),
    sameSite,
  };
}

/** Chromium's `samesite` column: -1 unspecified, 0 none, 1 lax, 2 strict. */
export function chromiumSameSite(value: number): SameSite {
  return value === 0
    ? "no_restriction"
    : value === 1
      ? "lax"
      : value === 2
        ? "strict"
        : "unspecified";
}

/** Firefox's `sameSite` column: 0 none, 1 lax, 2 strict. */
export function firefoxSameSite(value: number): SameSite {
  return value === 1
    ? "lax"
    : value === 2
      ? "strict"
      : value === 0
        ? "no_restriction"
        : "unspecified";
}
