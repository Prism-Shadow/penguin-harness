/**
 * The sidebar's page entries (pure decisions, unit tested). Development mode's fixed block is New
 * chat and then these entries, each a plain row: Agents and the App Center today (PRFC-0033), plus
 * any main-nav page a module contributes. They cannot be starred, dragged or folded; the system
 * apps (Models, Plugins and the rest) are the App Center's tiles, not entries (lib/system-apps.ts).
 */

/**
 * A main-nav page as the nav reads it: WebApp's main-nav pages (web-app/page-table.ts,
 * `navPagesOf`), passed in by the caller since they are module contributions read from the booted
 * tree. Each key names its route (`/<key>`); its title and glyph are the page's own data. Some
 * entries are admin-only and some not yet released (see below), so the sidebar renders
 * navKeysFor(pages, user.isAdmin), not the raw list. Traces is deliberately absent: reading a
 * Trace happens in the chat toolbar's panel switcher, which is the only place it happens.
 *
 * `admin`: the server refuses the page to a non-admin, so the sidebar does not offer it. On a
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
 * way entries are. A child is not an entry: it is drawn indented under its parent. The collapsed
 * rail draws entries only, and lights the parent's while a child is open.
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
