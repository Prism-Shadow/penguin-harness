/**
 * Dock arrangements stored before the terminal became one panel (2026-10-19) hold a tab per
 * shell, keyed `terminal:<id>`. Read back, each dock's first such tab becomes the terminal
 * panel's tab in its place and the others are dropped; a dock that showed one of them shows the
 * panel, and the shell it showed stays the shown one (the right dock's first, as duplicate panel
 * tabs resolve). An arrangement with no conversation behind it — a draft's (`<project>:new`) or
 * none at all (`~…`) — has no terminal, and simply loses them.
 *
 * The only reader of the old form, applied to the raw stored scope before dock-state.ts sanitizes
 * it. Remove this file and its one call once `penguin.dock.layout` next changes shape (the
 * 2026-10-18 terminal-scope changelog entry says so).
 */

const LEGACY_PREFIX = "terminal:";
/** The terminal panel's id (dock-terminal.ts `TERMINAL_PANEL`). */
const PANEL = "terminal";

type Raw = Record<string, unknown>;

/** One dock's stored area folded; `shown` is the shell it was showing, if it showed one. */
function foldArea(rawArea: unknown, keep: boolean): { area: unknown; shown: string | null } {
  if (typeof rawArea !== "object" || rawArea === null) return { area: rawArea, shown: null };
  const area = rawArea as Raw;
  if (!Array.isArray(area.tabs)) return { area: rawArea, shown: null };
  let placed = false;
  const tabs: unknown[] = [];
  for (const key of area.tabs) {
    if (typeof key !== "string" || !key.startsWith(LEGACY_PREFIX)) tabs.push(key);
    else if (keep && !placed) {
      tabs.push(PANEL);
      placed = true;
    }
  }
  const active = area.active;
  if (typeof active !== "string" || !active.startsWith(LEGACY_PREFIX)) {
    return { area: { ...area, tabs }, shown: null };
  }
  return {
    area: { ...area, tabs, active: keep ? PANEL : null },
    shown: active.slice(LEGACY_PREFIX.length),
  };
}

export function foldLegacyTerminalTabs(scopeKey: string, raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const scope = raw as Raw;
  const keep = !scopeKey.startsWith("~") && !scopeKey.includes(":");
  const right = foldArea(scope.right, keep);
  const bottom = foldArea(scope.bottom, keep);
  const folded: Raw = { ...scope, right: right.area, bottom: bottom.area };
  const shown = right.shown ?? bottom.shown;
  if (keep && shown !== null && typeof scope.shell !== "string") folded.shell = shown;
  return folded;
}
