/**
 * System browser import: discovers the Chromium-family and Firefox profiles on this machine
 * and reads their cookies (decrypted) and history, for the built-in browser to take over.
 * Reads only — nothing here writes to a system browser's files.
 */
import type {
  BuiltinBrowserHistoryEntry,
  BuiltinBrowserImportSource,
  DesktopBrowserCookie,
} from "../../api/types.js";

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
  /** Rows read from the store, before filtering. */
  found: number;
  /** Rows that could not be decrypted or were expired. */
  skipped: number;
  warnings: string[];
}

export interface HistoryReadResult {
  entries: BuiltinBrowserHistoryEntry[];
  warnings: string[];
}

export function listImportSources(_env?: ImportEnv): BuiltinBrowserImportSource[] {
  return [];
}

export async function readCookies(
  _source: BuiltinBrowserImportSource,
  _opts: { domains?: string[] },
  _env?: ImportEnv,
): Promise<CookieReadResult> {
  throw new Error("not implemented");
}

export async function readHistory(
  _source: BuiltinBrowserImportSource,
  _env?: ImportEnv,
): Promise<HistoryReadResult> {
  throw new Error("not implemented");
}
