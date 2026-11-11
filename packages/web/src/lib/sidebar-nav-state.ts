/**
 * The sidebar's nav entries and how they fold (pure decisions, unit tested). In development
 * mode every entry — New chat, then the pages below — is either PINNED (a favourite), always
 * shown in the fixed block under the switcher, or COLLAPSIBLE, inside the area a nav-row-wide
 * chevron button under it folds away (arrow up = collapse; collapsed, the button stays — arrow
 * down — as the way back). New chat, Agents, the App Center, Models and Plugins are pinned by
 * default; the user moves an entry across with the row's star or by dragging it into or out of
 * the collapsible area. Both areas keep page order, and with nothing collapsible there is no
 * chevron. A
 * contributed mode's rows (company mode's pages) split the same way, with none pinned by
 * default and each mode's choices kept apart (see the section at the end).
 *
 * Global storage keys, not per Project: the nav is identical everywhere, so like the
 * grouping mode (GROUP_MODE_KEY) the fold and the pin choices are single user preferences —
 * changing them anywhere changes them everywhere. Storage is injectable
 * (model-group-expansion.ts convention: vitest runs in Node, no localStorage); nothing
 * stored, unrecognized values, and throwing storage all fall back to the defaults.
 */

/**
 * A main-nav page as the nav reads it: WebApp's main-nav pages (web-app/page-table.ts,
 * `navPagesOf`), passed in by the caller since they are module contributions read from the booted
 * tree. Each key names its route (`/<key>`); its title and glyph are the page's own data. Some
 * entries are admin-only and some not yet released (see below), so the sidebar renders
 * navKeysFor(pages, user.isAdmin), not the raw list. Traces is deliberately absent: reading a
 * Trace happens in the chat toolbar's panel switcher, which is the only place it happens.
 *
 * `admin`: the server refuses the page to a non-admin, so the sidebar does not offer it.
 * Machines installs software on another machine over ssh with the SERVER account's keys, which
 * `/api/machines` gates on `isAdmin` — a row that always answers 403 is worse than no row. On a
 * personal or desktop server the only account IS the admin, so nothing is hidden there.
 *
 * `released: false`: built but not yet offered. The page keeps its place — it, its route and
 * its server routes all still exist and are reachable from a test — and is simply not put in
 * front of anyone, so releasing one is flipping its contribution's flag rather than restoring
 * code.
 */
export interface NavPage {
  key: string;
  admin: boolean;
  released: boolean;
  /** The page this one sits under (web-app/page-table.ts): it is not an entry of its own. */
  parent?: string;
}

const offered = (p: NavPage, isAdmin: boolean) => p.released && (isAdmin || !p.admin);

/** The nav as this user sees it: the top-level page keys, in table order. */
export function navKeysFor(pages: readonly NavPage[], isAdmin: boolean): readonly string[] {
  return pages.filter((p) => p.parent === undefined && offered(p, isAdmin)).map((p) => p.key);
}

/**
 * The pages each entry carries below it, by the entry's key, in table order and offered the
 * way entries are. A child is not an entry: it has no pin choice and no drag, and it is drawn
 * under its parent in whichever area the parent is, so folding or moving the parent moves it.
 * The collapsed rail draws entries only, and lights the parent's while a child is open.
 */
export function navChildKeysFor(
  pages: readonly NavPage[],
  isAdmin: boolean,
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const p of pages) {
    if (p.parent === undefined || !offered(p, isAdmin)) continue;
    const siblings = out.get(p.parent);
    if (siblings === undefined) out.set(p.parent, [p.key]);
    else siblings.push(p.key);
  }
  return out;
}

/**
 * A development-mode nav entry: New chat or a page. New chat opens a draft rather than a
 * route, so it is not a page; it is the one entry that is always pinned (see
 * isNavPinnable), while every page is pinned or collapsible at the user's choice.
 */
export type NavEntryKey = string;

/** New chat's entry key: no page is keyed so. */
export const NEW_CHAT_ENTRY = "newChat";

/** Every entry this user sees, in rendered order: New chat first, then their pages. */
export function navEntryKeysFor(
  pages: readonly NavPage[],
  isAdmin: boolean,
): readonly NavEntryKey[] {
  return [NEW_CHAT_ENTRY, ...navKeysFor(pages, isAdmin)];
}

/**
 * Entries pinned until the user says otherwise; every other entry, a page added later included,
 * starts collapsible. The App Center is the Project's home screen, and a home screen folded away
 * is not one.
 */
export const DEFAULT_PINNED_NAV_KEYS: ReadonlySet<NavEntryKey> = new Set<NavEntryKey>([
  NEW_CHAT_ENTRY,
  "agents",
  "apps",
  "models",
  "plugins",
]);

/**
 * The user's pin choices that differ from the defaults, by entry: true = pinned, false =
 * collapsible. An entry absent here takes its default, which is what lets a page added in a
 * later release arrive where its own default puts it.
 */
export type NavPinOverrides = Readonly<Partial<Record<NavEntryKey, boolean>>>;

/** Whether the user may move an entry between the areas: every page may; New chat never folds away. */
export function isNavPinnable(key: NavEntryKey): boolean {
  return key !== NEW_CHAT_ENTRY;
}

export function isNavPinned(key: NavEntryKey, overrides: NavPinOverrides): boolean {
  if (!isNavPinnable(key)) return true;
  return overrides[key] ?? DEFAULT_PINNED_NAV_KEYS.has(key);
}

/** The two areas, each keeping the order `keys` has — the page table's, whatever order the entries were moved in. */
export function splitNavEntries(
  keys: readonly NavEntryKey[],
  overrides: NavPinOverrides,
): { pinned: NavEntryKey[]; collapsible: NavEntryKey[] } {
  return splitBy(keys, (key) => isNavPinned(key, overrides));
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
  if (!isNavPinnable(key)) return overrides;
  return withPinned(overrides, key, pinned, isNavPinned(key, overrides), DEFAULT_PINNED_NAV_KEYS);
}

/** Both areas of `items`, in their order. */
function splitBy<T>(
  items: readonly T[],
  isPinned: (item: T) => boolean,
): { pinned: T[]; collapsible: T[] } {
  const pinned: T[] = [];
  const collapsible: T[] = [];
  for (const item of items) {
    if (isPinned(item)) pinned.push(item);
    else collapsible.push(item);
  }
  return { pinned, collapsible };
}

/** The deviation-only write both kinds of nav make: `now` is the entry's current state. */
function withPinned(
  overrides: Readonly<Partial<Record<string, boolean>>>,
  key: string,
  pinned: boolean,
  now: boolean,
  defaults: ReadonlySet<string>,
): Readonly<Partial<Record<string, boolean>>> {
  if (now === pinned) return overrides;
  const next: Partial<Record<string, boolean>> = { ...overrides };
  if (pinned === defaults.has(key)) delete next[key];
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
  pages: readonly NavPage[],
  collapsed: boolean,
  isAdmin = true,
  overrides: NavPinOverrides = {},
): readonly NavEntryKey[] {
  const { pinned, collapsible } = splitNavEntries(navEntryKeysFor(pages, isAdmin), overrides);
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

/**
 * Reads the stored choices. Only a boolean under a key of `pages` is kept (the whole main nav,
 * pages this user is not offered included; New chat is never a choice), so a key this build
 * does not have — a page since removed, a hand edit — is ignored rather than trusted; absent,
 * unparseable or throwing storage reads as no choices, i.e. the defaults. `localStorage` is
 * resolved inside the try for the reason initialNavGroupCollapsed gives.
 */
export function initialNavPinOverrides(
  pages: readonly NavPage[],
  storage?: NavCollapseStorage,
): NavPinOverrides {
  const known = new Set(pages.map((p) => p.key));
  return readPinOverrides(NAV_PINNED_KEY, (key) => known.has(key), storage);
}

/** Writes the choices on every change (best-effort, like the fold). */
export function storeNavPinOverrides(
  overrides: NavPinOverrides,
  storage?: NavCollapseStorage,
): void {
  writePinOverrides(NAV_PINNED_KEY, overrides, storage);
}

function readPinOverrides(
  storageKey: string,
  known: (key: string) => boolean,
  storage: NavCollapseStorage | undefined,
): Readonly<Partial<Record<string, boolean>>> {
  const overrides: Partial<Record<string, boolean>> = {};
  try {
    const parsed: unknown = JSON.parse((storage ?? localStorage).getItem(storageKey) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return overrides;
    for (const [key, value] of Object.entries(parsed)) {
      if (known(key) && typeof value === "boolean") overrides[key] = value;
    }
  } catch {
    /* no choices: the defaults */
  }
  return overrides;
}

function writePinOverrides(
  storageKey: string,
  overrides: Readonly<Partial<Record<string, boolean>>>,
  storage: NavCollapseStorage | undefined,
): void {
  try {
    (storage ?? localStorage).setItem(storageKey, JSON.stringify(overrides));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

// ---------------------------------------------------------------------------------------------
// A contributed mode's rows
// ---------------------------------------------------------------------------------------------

/**
 * A contributed mode's rows (company mode: the organization's six pages and the company-mode
 * pages plugins add) split the same way, with one difference: none is pinned until the user
 * pins it, so the whole set starts in the fold, as it did before modes had favourites. Every
 * row may move; no mode has a New chat. Keyed by the rows' own keys.
 */
export type ModeNavPinOverrides = Readonly<Partial<Record<string, boolean>>>;

const NO_DEFAULT_PINS: ReadonlySet<string> = new Set<string>();

export function isModeNavPinned(key: string, overrides: ModeNavPinOverrides): boolean {
  return overrides[key] ?? false;
}

/** Both areas of a mode's rows, in the mode's order. */
export function splitModeNavItems<T extends { key: string }>(
  items: readonly T[],
  overrides: ModeNavPinOverrides,
): { pinned: T[]; collapsible: T[] } {
  return splitBy(items, (item) => isModeNavPinned(item.key, overrides));
}

/** withNavPinned's write for a mode's row: deviations only, and the same record when nothing changes. */
export function withModeNavPinned(
  overrides: ModeNavPinOverrides,
  key: string,
  pinned: boolean,
): ModeNavPinOverrides {
  return withPinned(overrides, key, pinned, isModeNavPinned(key, overrides), NO_DEFAULT_PINS);
}

/**
 * Each mode's choices, under a key of its own (`<prefix><mode key>`): the modes name different
 * pages, and a star in one mode must never move an entry in another.
 */
export const MODE_NAV_PINNED_PREFIX = "penguin.sidebarModeNavPinned.";

/**
 * Reads one mode's choices, by initialNavPinOverrides' rules, except that any key is kept: a
 * mode's rows come from its contribution at render time, and a stored key no row has any more
 * simply matches nothing.
 */
export function initialModeNavPinOverrides(
  mode: string,
  storage?: NavCollapseStorage,
): ModeNavPinOverrides {
  return readPinOverrides(`${MODE_NAV_PINNED_PREFIX}${mode}`, () => true, storage);
}

/** Writes one mode's choices on every change (best-effort). */
export function storeModeNavPinOverrides(
  mode: string,
  overrides: ModeNavPinOverrides,
  storage?: NavCollapseStorage,
): void {
  writePinOverrides(`${MODE_NAV_PINNED_PREFIX}${mode}`, overrides, storage);
}
