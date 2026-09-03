/**
 * The web app's pages, from its own manifest (src/module.json — the `web.pages` slot the
 * server's web module declares). The router mounts them and the sidebar's nav group is
 * derived from them, so a page is one JSON entry: its route, whether it sits in the main
 * nav, whether the server refuses it to non-admins, and which renderer draws it.
 *
 * The same shape arrives from the server (GET /api/contributions) for pages a pushed
 * platform or a plugin contributes; `mergePages` folds those in — a page whose
 * renderer this build does not carry is skipped, since there is nothing to draw it with.
 */
import manifest from "../module.json";

export interface PageEntry {
  id: string;
  key: string;
  path: string;
  nav: "main" | "none";
  admin: boolean;
  /** Built but not yet offered: kept in the manifest, reachable by URL and tests, hidden from the nav. */
  released: boolean;
  renderer: { builtin: string } | { iframe: { src: string; namespace: string } };
}

export const PAGES: readonly PageEntry[] = manifest.contributes["web.pages"] as PageEntry[];

/** Keys of the pages in the main nav, in manifest order — the nav manifest. */
export const NAV_PAGE_KEYS: readonly string[] = PAGES.filter((p) => p.nav === "main").map(
  (p) => p.key,
);

/** The nav as this user sees it: released pages, minus admin-only ones for a non-admin. */
export function navPagesFor(isAdmin: boolean): readonly PageEntry[] {
  return PAGES.filter((p) => p.nav === "main" && p.released && (isAdmin || !p.admin));
}

/**
 * Local pages plus server-contributed ones this build can render. A server entry whose
 * key a local page already owns is ignored — the local manifest wins for its own pages.
 */
export function mergePages(
  local: readonly PageEntry[],
  remote: ReadonlyArray<Record<string, unknown>>,
  builtinRenderers: ReadonlySet<string>,
): PageEntry[] {
  const keys = new Set(local.map((p) => p.key));
  const out = [...local];
  for (const entry of remote) {
    const page = entry as Partial<PageEntry>;
    if (typeof page.key !== "string" || typeof page.path !== "string" || keys.has(page.key))
      continue;
    const renderer = page.renderer;
    if (renderer === undefined) continue;
    if ("builtin" in renderer && !builtinRenderers.has(renderer.builtin)) continue;
    out.push({
      id: typeof page.id === "string" ? page.id : `remote.${page.key}`,
      key: page.key,
      path: page.path,
      nav: page.nav === "main" ? "main" : "none",
      admin: page.admin === true,
      released: page.released !== false,
      renderer,
    });
    keys.add(page.key);
  }
  return out;
}
