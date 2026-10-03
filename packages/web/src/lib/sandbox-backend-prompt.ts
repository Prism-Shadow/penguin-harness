/**
 * When the Sandbox card offers to install a sandbox backend: the admin turned the switch on,
 * the machine reports no backend for its OS, it names a package to suggest, and nobody ticked
 * "Don't ask again" for that machine in this browser.
 *
 * The OS and the package come from the server (`PluginConfigEntry.backend`); this module never
 * guesses either. "Don't ask again" is remembered per machine in this browser only — it is a
 * question about this person's prompts, not a setting of the machine — so it is never sent to
 * a server. Storage that is unavailable or throws (a private window, blocked site data) reads
 * as "never dismissed" and drops the write: the prompt then asks again, which is the safe side.
 */
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";

/** localStorage key: a JSON array of the machine keys whose prompt was dismissed for good. */
export const BACKEND_PROMPT_DISMISSED_KEY = "penguin.sandboxBackendPromptDismissed";

/**
 * The key for the server this page is served from, which has no machine id: the Plugins page's
 * machine-picker value for it too (a machine id is never this short).
 */
export const THIS_SERVER_KEY = "*";

/** The storage this reads and writes — localStorage, or a stub in tests. */
export type PromptStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): PromptStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function dismissedIn(storage: PromptStorage | null): string[] {
  try {
    const raw = storage?.getItem(BACKEND_PROMPT_DISMISSED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Whether "Don't ask again" was ticked for this machine in this browser. */
export function backendPromptDismissed(
  machine: string,
  storage: PromptStorage | null = defaultStorage(),
): boolean {
  return dismissedIn(storage).includes(machine);
}

/** Remembers "Don't ask again" for this machine; a storage that refuses the write is ignored. */
export function dismissBackendPrompt(
  machine: string,
  storage: PromptStorage | null = defaultStorage(),
): void {
  const list = dismissedIn(storage);
  if (list.includes(machine)) return;
  try {
    storage?.setItem(BACKEND_PROMPT_DISMISSED_KEY, JSON.stringify([...list, machine]));
  } catch {
    // Not remembered: the next switch-on asks again.
  }
}

/**
 * The package to offer when the switch is turned on for this entry on this machine, or null
 * when there is nothing to ask: a backend for the OS is installed, the OS has no default, the
 * server does not report it, or the prompt was dismissed for this machine.
 */
export function backendToOffer(
  entry: Pick<PluginConfigEntry, "backend">,
  machine: string,
  storage: PromptStorage | null = defaultStorage(),
): string | null {
  const report = entry.backend;
  if (report === undefined || report.installed || report.recommended === undefined) return null;
  return backendPromptDismissed(machine, storage) ? null : report.recommended;
}
