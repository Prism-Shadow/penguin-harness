import type { Settings } from "./setting.js";

/** Defaults used by an installation with no administrator override. */
export const DEFAULT_TERMINAL_LIMIT = 12;
export const DEFAULT_BROWSER_LIMIT = 20;

const limits = {
  terminalMaxOpen: { key: "terminal_max_open", fallback: DEFAULT_TERMINAL_LIMIT },
  browserMaxOpen: { key: "browser_max_open", fallback: DEFAULT_BROWSER_LIMIT },
};
export type ResourceLimit = keyof typeof limits;

export function readResourceLimit(settings: Pick<Settings, "get">, limit: ResourceLimit): number {
  const { key, fallback } = limits[limit];
  const value = Number(settings.get(key));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function writeResourceLimit(
  settings: Pick<Settings, "set">,
  limit: ResourceLimit,
  value: number,
): void {
  settings.set(limits[limit].key, String(value));
}
