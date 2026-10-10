/**
 * Cookies of a Firefox profile (`cookies.sqlite`, table `moz_cookies`). Values are plaintext.
 * `expiry` counts seconds in older builds and milliseconds in newer ones; a value above 1e11
 * (the year 5138 in seconds) is read as milliseconds. Cookies kept for a container or
 * partitioned to a third-party context (a non-empty `originAttributes`) are skipped: they
 * belong to one context, not to the site.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  firefoxSameSite,
  inDomains,
  isExpired,
  toDesktopCookie,
  type StoredCookie,
} from "./cookie-rules.js";
import type { DiscoveredProfile } from "./discovery.js";
import type { CookieReadResult, ImportEnv } from "./index.js";
import { columnsOf, readDatabaseCopy, unreadableStoreWarning } from "./sqlite-copy.js";

/** Above this, `expiry` is milliseconds rather than seconds. */
export const EXPIRY_MS_THRESHOLD = 1e11;
/** 9999-12-31, the latest expiry a cookie is given. */
const MAX_EXPIRY_SECONDS = 253402300799;

interface FirefoxCookieRow {
  host: string;
  name: string;
  value: string | null;
  path: string | null;
  expires: number;
  secure: number;
  http_only: number;
  same_site: number;
  origin: string;
}

export async function readFirefoxCookies(
  profile: DiscoveredProfile,
  domains: readonly string[],
  env: ImportEnv,
): Promise<CookieReadResult> {
  if (profile.cookiesFile === null) {
    return { cookies: [], found: 0, skipped: 0, warnings: ["This profile has no cookie store."] };
  }
  let rows: FirefoxCookieRow[];
  try {
    rows = await readDatabaseCopy(profile.cookiesFile, env, readStore);
  } catch (err) {
    return {
      cookies: [],
      found: 0,
      skipped: 0,
      warnings: [unreadableStoreWarning(err, "Firefox", "cookie store")],
    };
  }
  const matching = rows.filter((row) => inDomains(row.host, domains));
  const now = Math.floor(Date.now() / 1000);
  const result: CookieReadResult = {
    cookies: [],
    found: matching.length,
    skipped: 0,
    warnings: [],
  };
  for (const row of matching) {
    const stored: StoredCookie = {
      host: row.host,
      name: row.name,
      value: row.value ?? "",
      path: row.path || "/",
      secure: row.secure === 1,
      httpOnly: row.http_only === 1,
      expires: Math.max(0, Math.floor(row.expires)),
      sameSite: firefoxSameSite(row.same_site),
    };
    if (row.origin !== "" || isExpired(stored, now)) {
      result.skipped++;
      continue;
    }
    result.cookies.push(toDesktopCookie(stored));
  }
  return result;
}

function readStore(db: DatabaseSync): FirefoxCookieRow[] {
  const columns = columnsOf(db, "moz_cookies");
  const sameSite = columns.has("sameSite") ? "sameSite" : "0";
  const origin = columns.has("originAttributes") ? "originAttributes" : "''";
  // The seconds/milliseconds decision and the cap happen in SQL, where a far-future expiry
  // cannot overflow a JavaScript number on the way out.
  return db
    .prepare(
      `SELECT host, name, value, path,
         MIN(CASE WHEN expiry > ${EXPIRY_MS_THRESHOLD} THEN expiry / 1000 ELSE expiry END,
             ${MAX_EXPIRY_SECONDS}) AS expires,
         isSecure AS secure, isHttpOnly AS http_only, ${sameSite} AS same_site,
         ${origin} AS origin
       FROM moz_cookies`,
    )
    .all() as unknown as FirefoxCookieRow[];
}
