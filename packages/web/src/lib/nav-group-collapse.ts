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
 * unit tests) rather than duplicated. Some entries are admin-only (see below), so the
 * sidebar renders navKeysFor(user.isAdmin), not the raw manifest. Traces is deliberately
 * absent: reading a Trace happens in the chat toolbar's panel switcher, which is the only
 * place it happens.
 */
import { NAV_PAGE_KEYS, PAGES } from "./pages";

export type NavGroupKey =
  | "agents"
  | "plugins"
  | "models"
  | "extensions"
  | "machines"
  | "usage"
  | "benchmark";
/**
 * The manifest, derived from the app's own module.json (lib/pages.ts): every page whose
 * `nav` is "main", in manifest order. The literal key type above is the set the strings
 * and icons are typed against; pages.test.ts pins that the manifest never names a key
 * outside it.
 */
export const NAV_GROUP_KEYS = NAV_PAGE_KEYS as readonly NavGroupKey[];

/**
 * Entries the server refuses to a non-admin, so the sidebar does not offer them. Machines
 * installs software on another machine over ssh with the SERVER account's keys, which
 * `/api/machines` gates on `isAdmin` — a row that always answers 403 is worse than no row.
 * On a personal or desktop server the only account IS the admin, so nothing is hidden there.
 */
const ADMIN_ONLY_NAV_KEYS: ReadonlySet<NavGroupKey> = new Set(
  PAGES.filter((p) => p.nav === "main" && p.admin).map((p) => p.key as NavGroupKey),
);

/**
 * Entries built but not yet offered. They keep their place in the manifest — the page, its
 * route and its server routes all still exist and are reachable from a test — and are simply
 * not put in front of anyone, so releasing one is deleting its name from this set rather than
 * restoring code.
 *
 * `machines` installs this build onto another host over ssh with the server account's keys.
 * That is a capability worth shipping deliberately rather than as a row that happens to appear,
 * so it waits for a release that means to introduce it.
 */
const UNRELEASED_NAV_KEYS: ReadonlySet<NavGroupKey> = new Set(
  PAGES.filter((p) => p.nav === "main" && !p.released).map((p) => p.key as NavGroupKey),
);

/** The manifest as this user sees it. */
export function navKeysFor(isAdmin: boolean): readonly NavGroupKey[] {
  const offered = NAV_GROUP_KEYS.filter((key) => !UNRELEASED_NAV_KEYS.has(key));
  return isAdmin ? offered : offered.filter((key) => !ADMIN_ONLY_NAV_KEYS.has(key));
}

/**
 * Page entries that are visible and reachable: collapsing hides the whole group (the
 * chevron-button toggle and the pinned "New chat" block above are outside it and stay).
 * The sidebar keeps the rows mounted while collapsed — the collapse is an animated
 * height tween — but at zero height, faded out, and inert: exactly this empty set of
 * reachable entries.
 */
export function visibleNavKeys(collapsed: boolean, isAdmin = true): readonly NavGroupKey[] {
  return collapsed ? [] : navKeysFor(isAdmin);
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
