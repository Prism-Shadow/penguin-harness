/**
 * System browser import: discovers the Chromium-family and Firefox profiles on this machine
 * and reads their cookies (decrypted) and history, for the built-in browser to take over.
 * Reads only — nothing here writes to a system browser's files: every store is read through
 * a private copy (sqlite-copy.ts).
 *
 *   browsers.ts          where each browser keeps its data, per platform
 *   discovery.ts         the profiles found there (Local State, profiles.ini)
 *   chromium-keys.ts     the cookie keys: Keychain, keyring or DPAPI
 *   chromium-decrypt.ts  AES-CBC / AES-GCM and the version-24 host digest
 *   chromium-cookies.ts  a Chromium profile's cookies
 *   firefox-cookies.ts   a Firefox profile's cookies
 *   history.ts           either family's history
 *   cookie-rules.ts      the domain filter and the shell's cookie shape
 *   sqlite-copy.ts       reading a store through a private copy
 *   system-env.ts        the ImportEnv of the machine the server runs on
 */
import type {
  BuiltinBrowserHistoryEntry,
  BuiltinBrowserImportSource,
  DesktopBrowserCookie,
} from "../../api/types.js";
import { chromiumBrowser } from "./browsers.js";
import { readChromiumCookies } from "./chromium-cookies.js";
import { normalizeDomains } from "./cookie-rules.js";
import { discoverProfiles, findProfile, type DiscoveredProfile } from "./discovery.js";
import { readFirefoxCookies } from "./firefox-cookies.js";
import { readProfileHistory } from "./history.js";
import { systemImportEnv } from "./system-env.js";

/** The machine an import reads, injectable for tests. */
export interface ImportEnv {
  platform: NodeJS.Platform;
  homedir: string;
  env: Record<string, string | undefined>;
  tmpdir: string;
  /** Runs a helper (`security`, `secret-tool`, `powershell`) and returns its stdout; rejects on a non-zero exit. */
  exec(file: string, args: string[], input?: string): Promise<string>;
}

export interface CookieReadResult {
  cookies: DesktopBrowserCookie[];
  /** Rows read from the store that fall within `domains`, before any other filtering. */
  found: number;
  /** Rows that could not be decrypted, were expired, or belong to a single context (Firefox containers). */
  skipped: number;
  warnings: string[];
}

export interface HistoryReadResult {
  entries: BuiltinBrowserHistoryEntry[];
  warnings: string[];
}

/** No profile with the source's id on this machine (any more). */
export class ImportSourceNotFoundError extends Error {
  readonly code = "source_not_found";
  constructor(sourceId: string) {
    super(`No browser profile ${sourceId} on this machine.`);
    this.name = "ImportSourceNotFoundError";
  }
}

export function listImportSources(
  env: ImportEnv = systemImportEnv(),
): BuiltinBrowserImportSource[] {
  return discoverProfiles(env).map((profile) => profile.source);
}

export async function readCookies(
  source: BuiltinBrowserImportSource,
  opts: { domains?: string[] },
  env: ImportEnv = systemImportEnv(),
): Promise<CookieReadResult> {
  const profile = requireProfile(source, env);
  const domains = normalizeDomains(opts.domains);
  return profile.source.browser === "firefox"
    ? readFirefoxCookies(profile, domains, env)
    : readChromiumCookies(profile, chromiumBrowser(profile.source.browser), domains, env);
}

export async function readHistory(
  source: BuiltinBrowserImportSource,
  env: ImportEnv = systemImportEnv(),
): Promise<HistoryReadResult> {
  return readProfileHistory(requireProfile(source, env), env);
}

/**
 * The source's profile as discovered now: its files are located again rather than taken from
 * the caller, so a source can only ever name a profile discovery would list.
 */
function requireProfile(source: BuiltinBrowserImportSource, env: ImportEnv): DiscoveredProfile {
  const profile = findProfile(source.id, env);
  if (profile === undefined) throw new ImportSourceNotFoundError(source.id);
  return profile;
}
