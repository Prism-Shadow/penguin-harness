/**
 * Collapse state of the sidebar's page-nav group (pure decisions, unit tested): the
 * 智能体 → 评估中心 run of entries collapses as one group behind a nav-row-wide chevron
 * button under the group's last entry (arrow up = collapse; collapsed, the button
 * stays — arrow down — as the way back). The pinned "New chat" block above is NOT
 * part of the group — it stays visible in both states (the manifest below simply never
 * contains it).
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
 * unit tests) rather than duplicated. Traces is deliberately absent: the Trace panel
 * lives in the chat toolbar's panel switcher, and the /traces browsing page stays
 * reachable through its deep links (Agents page, session details).
 */
export const NAV_GROUP_KEYS = ["agents", "skills", "models", "usage", "benchmark"] as const;
export type NavGroupKey = (typeof NAV_GROUP_KEYS)[number];

/**
 * Page entries that are visible and reachable: collapsing hides the whole group (the
 * chevron-button toggle and the pinned "New chat" block above are outside it and stay).
 * The sidebar keeps the rows mounted while collapsed — the collapse is an animated
 * height tween — but at zero height, faded out, and inert: exactly this empty set of
 * reachable entries.
 */
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

/**
 * Reads the persisted choice; only an explicit "collapsed" collapses — anything else
 * (absent / unrecognized / throwing storage) is the expanded default. `localStorage` is
 * resolved INSIDE the try, never as a default parameter: merely touching it throws a
 * SecurityError when site data is blocked (or in a partitioned iframe), and this runs
 * from a useState initializer — an escaping throw would take the sidebar's first render
 * down.
 */
export function initialNavGroupCollapsed(storage?: NavCollapseStorage): boolean {
  try {
    return (storage ?? localStorage).getItem(NAV_GROUP_COLLAPSED_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Writes the choice on every toggle (best-effort: quota limits / private browsing fail silently). */
export function storeNavGroupCollapsed(collapsed: boolean, storage?: NavCollapseStorage): void {
  try {
    (storage ?? localStorage).setItem(
      NAV_GROUP_COLLAPSED_KEY,
      collapsed ? "collapsed" : "expanded",
    );
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}
