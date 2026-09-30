/**
 * The sidebar's nav entries and how they fold (pure decisions, unit tested). In development
 * mode every entry — New chat, then the page manifest below — is either PINNED, always
 * shown, or COLLAPSIBLE, inside the area a nav-row-wide chevron button under it folds away
 * (arrow up = collapse; collapsed, the button stays — arrow down — as the way back). New
 * chat, Agents, Models and Plugins are pinned by default; the user moves an entry across
 * with the row's pin button or by dragging it into or out of the collapsible area. Both
 * areas keep manifest order, and with nothing collapsible there is no chevron. Company
 * mode's six entries stay outside the split: they fold as one group behind the same button.
 *
 * Global storage keys, not per Project: the nav is identical everywhere, so like the
 * grouping mode (GROUP_MODE_KEY) the fold and the pin choices are single user preferences —
 * changing them anywhere changes them everywhere. Storage is injectable
 * (model-group-expansion.ts convention: vitest runs in Node, no localStorage); nothing
 * stored, unrecognized values, and throwing storage all fall back to the defaults.
 */

/**
 * Page entries of the nav, in rendered order. Each key names its route (`/<key>`), its
 * S.nav label, and its NAV_ICONS glyph — the sidebar derives its nav rows from this
 * manifest, so the covered range is pinned here (and in the unit tests) rather than
 * duplicated. Some entries are admin-only (see below), so the sidebar renders
 * navKeysFor(user.isAdmin), not the raw manifest. Traces is deliberately absent: reading a
 * Trace happens in the chat toolbar's panel switcher, which is the only place it happens.
 */
import { NAV_PAGE_KEYS, PAGES } from "./pages";

export type NavGroupKey = "agents" | "plugins" | "models" | "machines" | "usage" | "benchmark";
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
 * A development-mode nav entry: New chat or a page. New chat opens a draft rather than a
 * route, so it is not in the manifest, but it is pinned or collapsible like any page.
 */
export type NavEntryKey = "newChat" | NavGroupKey;

/** Every entry this user sees, in rendered order: New chat first, then their pages. */
export function navEntryKeysFor(isAdmin: boolean): readonly NavEntryKey[] {
  return ["newChat", ...navKeysFor(isAdmin)];
}

/** Entries pinned until the user says otherwise; every other entry, a page added later included, starts collapsible. */
export const DEFAULT_PINNED_NAV_KEYS: ReadonlySet<NavEntryKey> = new Set<NavEntryKey>([
  "newChat",
  "agents",
  "models",
  "plugins",
]);

/**
 * The user's pin choices that differ from the defaults, by entry: true = pinned, false =
 * collapsible. An entry absent here takes its default, which is what lets a page added in a
 * later release arrive where its own default puts it.
 */
export type NavPinOverrides = Readonly<Partial<Record<NavEntryKey, boolean>>>;

export function isNavPinned(key: NavEntryKey, overrides: NavPinOverrides): boolean {
  return overrides[key] ?? DEFAULT_PINNED_NAV_KEYS.has(key);
}

/** The two areas, each keeping the order `keys` has — the manifest's, whatever order the entries were moved in. */
export function splitNavEntries(
  keys: readonly NavEntryKey[],
  overrides: NavPinOverrides,
): { pinned: NavEntryKey[]; collapsible: NavEntryKey[] } {
  const pinned: NavEntryKey[] = [];
  const collapsible: NavEntryKey[] = [];
  for (const key of keys) {
    if (isNavPinned(key, overrides)) pinned.push(key);
    else collapsible.push(key);
  }
  return { pinned, collapsible };
}

/**
 * `overrides` with one entry pinned or unpinned — the write both the pin button and a drop
 * make. A choice that matches the default is removed rather than stored, so only deviations
 * are ever kept; a call that changes nothing returns `overrides` itself, and callers skip the
 * write on that identity.
 */
export function withNavPinned(
  overrides: NavPinOverrides,
  key: NavEntryKey,
  pinned: boolean,
): NavPinOverrides {
  if (isNavPinned(key, overrides) === pinned) return overrides;
  const next: Partial<Record<NavEntryKey, boolean>> = { ...overrides };
  if (pinned === DEFAULT_PINNED_NAV_KEYS.has(key)) delete next[key];
  else next[key] = pinned;
  return next;
}

/**
 * Entries that are visible and reachable, in rendered order: the pinned ones always, the
 * collapsible ones only while their area is expanded (the chevron-button toggle is outside
 * both and stays). The sidebar keeps folded rows mounted — the fold is an animated height
 * tween — but at zero height, faded out, and inert: exactly their absence from this list.
 */
export function visibleNavKeys(
  collapsed: boolean,
  isAdmin = true,
  overrides: NavPinOverrides = {},
): readonly NavEntryKey[] {
  const { pinned, collapsible } = splitNavEntries(navEntryKeysFor(isAdmin), overrides);
  return collapsed ? pinned : [...pinned, ...collapsible];
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface NavCollapseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The fold's single global key (`penguin.…` naming convention); holds "collapsed" / "expanded". */
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

/** The pin choices' single global key; holds NavPinOverrides as a JSON object. */
export const NAV_PINNED_KEY = "penguin.sidebarNavPinned";

/** Keys a stored choice may name: New chat and the whole manifest, pages this user is not offered included. */
const NAV_ENTRY_KEYS: ReadonlySet<string> = new Set<string>(["newChat", ...NAV_GROUP_KEYS]);

/**
 * Reads the stored choices. Only a boolean under a key the manifest knows is kept, so a key
 * this build does not have — a page since removed, a hand edit — is ignored rather than
 * trusted; absent, unparseable or throwing storage reads as no choices, i.e. the defaults.
 * `localStorage` is resolved inside the try for the reason initialNavGroupCollapsed gives.
 */
export function initialNavPinOverrides(storage?: NavCollapseStorage): NavPinOverrides {
  try {
    const parsed: unknown = JSON.parse((storage ?? localStorage).getItem(NAV_PINNED_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const overrides: Partial<Record<NavEntryKey, boolean>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (NAV_ENTRY_KEYS.has(key) && typeof value === "boolean") {
        overrides[key as NavEntryKey] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

/** Writes the choices on every change (best-effort, like the fold). */
export function storeNavPinOverrides(
  overrides: NavPinOverrides,
  storage?: NavCollapseStorage,
): void {
  try {
    (storage ?? localStorage).setItem(NAV_PINNED_KEY, JSON.stringify(overrides));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}
