/**
 * Browser-side memory of the shell's work mode and of the organization last opened in
 * company mode. Both are also stored server-side in the user's `ui_prefs` (`workMode`,
 * `lastOrgKey`), which is the copy that follows the user to another browser; these mirrors
 * exist so the first render after a reload already stands in the right mode instead of
 * flashing development mode until the preferences arrive — the same reason `lastProjectId`
 * is mirrored. Storage is injectable (nav-group-collapse.ts convention: vitest runs in Node
 * with no localStorage), and every read degrades to the default on anything unexpected.
 */
import type { WorkMode } from "../features/company/company-nav";
import { parseOrgKey } from "../features/company/company-nav";

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory one. */
export interface WorkModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WORK_MODE_KEY = "penguin.workMode";
export const LAST_ORG_KEY = "penguin.lastOrgKey";

/** The remembered mode; only an explicit "company" switches — anything else (absent, unrecognized, throwing storage) is development, the default. */
export function initialWorkMode(storage?: WorkModeStorage): WorkMode {
  try {
    return (storage ?? localStorage).getItem(WORK_MODE_KEY) === "company" ? "company" : "dev";
  } catch {
    return "dev";
  }
}

export function storeWorkMode(mode: WorkMode, storage?: WorkModeStorage): void {
  try {
    (storage ?? localStorage).setItem(WORK_MODE_KEY, mode);
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/** The remembered organization key, or null when nothing valid is stored. */
export function initialLastOrgKey(storage?: WorkModeStorage): string | null {
  try {
    const raw = (storage ?? localStorage).getItem(LAST_ORG_KEY);
    return parseOrgKey(raw) === null ? null : raw;
  } catch {
    return null;
  }
}

export function storeLastOrgKey(key: string, storage?: WorkModeStorage): void {
  try {
    (storage ?? localStorage).setItem(LAST_ORG_KEY, key);
  } catch {
    /* best-effort persistence */
  }
}
