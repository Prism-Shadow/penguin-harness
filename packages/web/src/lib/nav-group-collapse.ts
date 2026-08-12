/**
 * Collapse state of the sidebar's page-nav group (pure decisions, unit tested): the
 * 智能体 → 评估中心 run of entries collapses as one group behind a header toggle. The
 * pinned "New chat" block above the nav is NOT part of the group — it stays visible in
 * both states (the manifest below simply never contains it).
 *
 * One global storage key, not per Project: the nav is identical everywhere, so like the
 * grouping mode (GROUP_MODE_KEY) this is a single user preference — toggling it anywhere
 * toggles it everywhere. Storage is injectable (model-group-expansion.ts convention:
 * vitest runs in Node, no localStorage); nothing stored, unrecognized values, and
 * throwing storage all fall back to expanded — the default.
 */

/**
 * Page entries of the collapsible nav group, in rendered order. Each key names its
 * route (`/<key>`), its S.nav label, and its NAV_ICONS glyph — the sidebar derives
 * its nav rows from this manifest, so the covered range is pinned here (and in the
 * unit tests) rather than duplicated.
 */
export const NAV_GROUP_KEYS = [
  "agents",
  "skills",
  "models",
  "usage",
  "traces",
  "benchmark",
] as const;
export type NavGroupKey = (typeof NAV_GROUP_KEYS)[number];

/** Page entries that render: collapsing hides the whole group (the header toggle and the pinned "New chat" block above are outside it and stay). */
export function visibleNavKeys(collapsed: boolean): readonly NavGroupKey[] {
  return collapsed ? [] : NAV_GROUP_KEYS;
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface NavCollapseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The single global key (`penguin.…` naming convention); holds "collapsed" / "expanded". */
export const NAV_GROUP_COLLAPSED_KEY = "penguin.sidebarNavGroupCollapsed";

/** Reads the persisted choice; only an explicit "collapsed" collapses — anything else (absent / unrecognized / throwing storage) is the expanded default. */
export function initialNavGroupCollapsed(storage: NavCollapseStorage = localStorage): boolean {
  try {
    return storage.getItem(NAV_GROUP_COLLAPSED_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Writes the choice on every toggle (best-effort: quota limits / private browsing fail silently). */
export function storeNavGroupCollapsed(
  collapsed: boolean,
  storage: NavCollapseStorage = localStorage,
): void {
  try {
    storage.setItem(NAV_GROUP_COLLAPSED_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}
