/**
 * Cookies of a Chromium-family profile (`Network/Cookies`, or `Cookies` before Chrome 96).
 * A non-empty `value` column is a plaintext cookie and is used as-is; otherwise
 * `encrypted_value` is decrypted with the platform's keys, fetched only for the version tags
 * that actually occur among the requested cookies — so importing one site's cookies whose
 * values are all plaintext never prompts for the Keychain.
 *
 * Counts, never values, reach the warnings.
 */
import type { DatabaseSync } from "node:sqlite";
import type { ChromiumBrowser } from "./browsers.js";
import { cipherOf, decryptCookieValue } from "./chromium-decrypt.js";
import { cookieKeySource, type CookieKeys, type KeyFailure } from "./chromium-keys.js";
import {
  chromiumSameSite,
  inDomains,
  isExpired,
  toDesktopCookie,
  type StoredCookie,
} from "./cookie-rules.js";
import type { DiscoveredProfile } from "./discovery.js";
import type { CookieReadResult, ImportEnv } from "./index.js";
import { columnsOf, readDatabaseCopy, unreadableStoreWarning } from "./sqlite-copy.js";

interface CookieRow {
  host_key: string;
  name: string;
  value: string | null;
  encrypted_value: Uint8Array | null;
  path: string | null;
  /** Unix seconds (converted in SQL: the raw column exceeds a double's exact range); 0 = session. */
  expires: number;
  secure: number;
  http_only: number;
  same_site: number;
  /** A partitioned (CHIPS) cookie's top-level site; empty for an ordinary cookie. */
  partition_key: string | null;
}

export async function readChromiumCookies(
  profile: DiscoveredProfile,
  browser: ChromiumBrowser,
  domains: readonly string[],
  env: ImportEnv,
): Promise<CookieReadResult> {
  if (profile.cookiesFile === null) {
    return { cookies: [], found: 0, skipped: 0, warnings: ["This profile has no cookie store."] };
  }
  let store: { rows: CookieRow[]; version: number };
  try {
    store = await readDatabaseCopy(profile.cookiesFile, env, readStore);
  } catch (err) {
    return {
      cookies: [],
      found: 0,
      skipped: 0,
      warnings: [unreadableStoreWarning(err, browser.name, "cookie store")],
    };
  }

  const rows = store.rows.filter((row) => inDomains(row.host_key, domains));
  const now = Math.floor(Date.now() / 1000);
  const keysFor = cookieKeySource(browser, profile.root, env);

  const result: CookieReadResult = { cookies: [], found: rows.length, skipped: 0, warnings: [] };
  let appBound = 0;
  let undecryptable = 0;
  const keyless = new Map<KeyFailure, number>();
  for (const row of rows) {
    const stored: StoredCookie = {
      host: row.host_key,
      name: row.name,
      value: "",
      path: row.path || "/",
      secure: row.secure === 1,
      httpOnly: row.http_only === 1,
      expires: Math.max(0, Math.floor(row.expires)),
      sameSite: chromiumSameSite(row.same_site),
    };
    // A partitioned cookie belongs to its host only under one top-level site; written without
    // that site it would reach the host everywhere, so it stays behind.
    if (row.partition_key || isExpired(stored, now)) {
      result.skipped++;
      continue;
    }
    const encrypted = row.encrypted_value;
    if (row.value || encrypted === null || encrypted.length === 0) {
      stored.value = row.value ?? "";
    } else {
      const cipher = cipherOf(encrypted);
      if (cipher === "v20") {
        appBound++;
        result.skipped++;
        continue;
      }
      const available = cipher === "unknown" ? null : await keysFor(cipher);
      const value =
        available === null
          ? null
          : firstDecryption(encrypted, available, row.host_key, store.version);
      if (value === null) {
        result.skipped++;
        if (available?.failure !== undefined) {
          keyless.set(available.failure, (keyless.get(available.failure) ?? 0) + 1);
        } else {
          undecryptable++;
        }
        continue;
      }
      stored.value = value;
    }
    result.cookies.push(toDesktopCookie(stored));
  }

  if (appBound > 0) {
    result.warnings.push(
      `Skipped ${cookieCount(appBound)} protected by ${browser.name}'s app-bound encryption, which can't be imported on Windows; sign in inside the Browser panel instead.`,
    );
  }
  for (const [failure, count] of keyless) {
    result.warnings.push(keyFailureWarning(failure, count, browser));
  }
  if (undecryptable > 0) {
    result.warnings.push(`Skipped ${cookieCount(undecryptable)} that could not be decrypted.`);
  }
  return result;
}

const cookieCount = (n: number): string => (n === 1 ? "1 cookie" : `${n} cookies`);

function readStore(db: DatabaseSync): { rows: CookieRow[]; version: number } {
  const columns = columnsOf(db, "cookies");
  // Chrome renamed secure/httponly to is_secure/is_httponly (2019) and added samesite (2018).
  const secure = columns.has("is_secure") ? "is_secure" : "secure";
  const httpOnly = columns.has("is_httponly") ? "is_httponly" : "httponly";
  const sameSite = columns.has("samesite") ? "samesite" : "-1";
  // Partitioned (CHIPS) cookies carry their top-level site since Chrome 108.
  const partition = columns.has("top_frame_site_key") ? "top_frame_site_key" : "''";
  const rows = db
    .prepare(
      `SELECT host_key, name, value, encrypted_value, path,
         CASE WHEN expires_utc = 0 THEN 0 ELSE expires_utc / 1000000 - 11644473600 END AS expires,
         ${secure} AS secure, ${httpOnly} AS http_only, ${sameSite} AS same_site,
         ${partition} AS partition_key
       FROM cookies`,
    )
    .all() as unknown as CookieRow[];
  return { rows, version: storeVersion(db) };
}

/** The store's `meta.version`; 0 when the table or the row is missing. */
function storeVersion(db: DatabaseSync): number {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
      { value: unknown } | undefined;
    const version = Number(row?.value);
    return Number.isFinite(version) ? version : 0;
  } catch {
    return 0;
  }
}

function firstDecryption(
  encrypted: Uint8Array,
  keys: CookieKeys,
  hostKey: string,
  version: number,
): string | null {
  for (const key of keys.keys) {
    const value = decryptCookieValue(encrypted, key, keys.mode, hostKey, version);
    if (value !== null) return value;
  }
  return null;
}

function keyFailureWarning(failure: KeyFailure, count: number, browser: ChromiumBrowser): string {
  switch (failure) {
    case "keychain":
      return `Skipped ${cookieCount(count)}: the Keychain did not release "${browser.keychainService}". Allow the access when macOS asks, then import again.`;
    case "keyring":
      return `Skipped ${cookieCount(count)} encrypted with a key from the desktop keyring, which secret-tool could not provide.`;
    case "dpapi":
      return `Skipped ${cookieCount(count)}: Windows could not unlock ${browser.name}'s cookie key.`;
  }
}
