/**
 * The cookies the user's Chrome extension hands over (its `read-cookies` reply), put through the
 * rules a profile's own cookies pass: the `domains` filter, partitioned and expired cookies left
 * behind and counted, and the shell's cookie shape. Chrome has already decrypted them — this is
 * the route to the cookies its app-bound encryption keeps from the disk import.
 *
 * The reply comes from outside the server, so it is checked whole before anything is read: a
 * reply that is not a list of cookies fails the import rather than importing part of it.
 */
import type { ChromeExtensionCookie } from "../../api/types.js";
import { inDomains, isExpired, toDesktopCookie, type StoredCookie } from "./cookie-rules.js";
import type { CookieReadResult } from "./index.js";
import { SkipTally } from "./skips.js";

/** The id of the import source that reads through the user's connected Chrome extension. */
export const EXTENSION_SOURCE_ID = "chrome-extension";

const SAME_SITE: readonly string[] = ["unspecified", "no_restriction", "lax", "strict"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isExtensionCookie(value: unknown): value is ChromeExtensionCookie {
  if (!isRecord(value)) return false;
  const strings = ["domain", "name", "value", "path"].every((k) => typeof value[k] === "string");
  const flags = ["hostOnly", "secure", "httpOnly"].every((k) => typeof value[k] === "boolean");
  return (
    strings &&
    flags &&
    value.domain !== "" &&
    typeof value.sameSite === "string" &&
    SAME_SITE.includes(value.sameSite) &&
    (value.expirationDate === undefined ||
      (typeof value.expirationDate === "number" && Number.isFinite(value.expirationDate))) &&
    (value.partitioned === undefined || typeof value.partitioned === "boolean")
  );
}

/** The cookies in a `read-cookies` reply; null when the reply is not one. */
export function parseExtensionCookies(reply: unknown): ChromeExtensionCookie[] | null {
  if (!isRecord(reply) || !Array.isArray(reply.cookies)) return null;
  return reply.cookies.every(isExtensionCookie) ? reply.cookies : null;
}

export function readExtensionCookies(
  cookies: readonly ChromeExtensionCookie[],
  domains: readonly string[],
  nowSeconds = Math.floor(Date.now() / 1000),
): CookieReadResult {
  const kept: CookieReadResult["cookies"] = [];
  const skips = new SkipTally();
  let found = 0;
  for (const cookie of cookies) {
    // Chrome names a domain cookie with or without its leading dot; the store's form has one.
    const bare = cookie.domain.replace(/^\./, "");
    const host = cookie.hostOnly ? bare : `.${bare}`;
    if (!inDomains(host, domains)) continue;
    found++;
    const stored: StoredCookie = {
      host,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || "/",
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expires:
        cookie.expirationDate === undefined ? 0 : Math.max(1, Math.floor(cookie.expirationDate)),
      sameSite: cookie.sameSite,
    };
    if (cookie.partitioned === true) skips.add("partitioned");
    else if (isExpired(stored, nowSeconds)) skips.add("expired");
    else kept.push(toDesktopCookie(stored));
  }
  return { cookies: kept, found, skips: skips.list(), notes: [] };
}
