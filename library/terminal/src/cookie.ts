/**
 * The session cookie, read the way the terminal seam reads it.
 *
 * The cookie's name and the two helpers live in the server's auth middleware — but that
 * middleware cannot be imported from a library package, and the terminal seam (the runtime's
 * WebSocket upgrades and the platform's identity resolver) is the one caller that needs the
 * helpers WITHOUT the middleware: it authenticates the same session cookie through the
 * claimed AuthService instead. So the helpers are spelled here, against the name the API
 * contract declares (SESSION_COOKIE), and they behave exactly as the middleware's do.
 */
import { parse } from "hono/utils/cookie";
import { SESSION_COOKIE } from "@prismshadow/penguin-library-machine/contract";

/** Browsers share cookies across ports; non-browser jars retain the legacy plain name. */
export function sessionCookieName(requestUrl: string | URL, browser: boolean): string {
  const port = browser ? new URL(requestUrl).port : "";
  return port ? `${SESSION_COOKIE}_${port}` : SESSION_COOKIE;
}

/** Prefer this request URL's port cookie, retaining the legacy plain-cookie fallback. */
export function sessionCookies(
  cookies: Record<string, string | undefined>,
  requestUrl: string | URL,
): { name: string; token: string }[] {
  const own = sessionCookieName(requestUrl, true);
  const names = own === SESSION_COOKIE ? [own] : [own, SESSION_COOKIE];
  return names.flatMap((name) => {
    const token = cookies[name];
    return token ? [{ name, token }] : [];
  });
}

/** Use the same public parser as hono/cookie: first duplicate wins, bad escapes never throw. */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  return parse(header ?? "");
}
