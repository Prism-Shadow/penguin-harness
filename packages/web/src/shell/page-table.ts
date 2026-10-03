/**
 * The web app's pages. Each one is a contribution to WebApp's `pages` slot (web-app/module.ts):
 * the feature that owns it declares its route, its frame, whether it sits in the main nav,
 * whether the server refuses it to non-admins, whether it is offered yet, and its place, and
 * binds the component that draws it. `pageTableOf` turns the contributions into the table the
 * router mounts and the sidebar derives its nav group from.
 *
 * Pages a pushed platform or a plugin contributes arrive from the server (GET
 * /api/contributions) in the `PageEntry` shape, which names a renderer instead of carrying a
 * component; `mergePages` folds those in — a page whose renderer this build does not carry is
 * skipped, since there is nothing to draw it with.
 */
import type { ComponentType } from "react";
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import manifest from "../module.json";

/** One page as its feature declares it: the data half of a `pages` contribution. */
export interface PageData {
  key: string;
  path: string;
  /** "bare" mounts outside the app shell (no sidebar, no Project context): the terminal, a workflow's app page. */
  frame: "shell" | "bare";
  nav: "main" | "none";
  admin: boolean;
  /** Built but not yet offered: reachable by URL and tests, hidden from the nav. */
  released: boolean;
  /** The page's place in the table, and so in the nav. */
  order: number;
}

/** A page with the component its feature bound. */
export interface WebAppPage extends PageData {
  id: string;
  Component: ComponentType;
}

/** The `pages` contributions as the router and the nav read them, by `order`. */
export function pageTableOf(contributions: readonly Contributed[]): readonly WebAppPage[] {
  return contributions
    .map((c) => ({
      ...(c.data as unknown as PageData),
      id: c.id,
      Component: c.code as ComponentType,
    }))
    .sort((a, b) => a.order - b.order);
}

/** The main nav's pages, in table order — offered or not, for any role. */
export function navPagesOf(pages: readonly WebAppPage[]): readonly WebAppPage[] {
  return pages.filter((p) => p.nav === "main");
}

/** A page as the server contributes it: a renderer reference instead of a component. */
export interface PageEntry {
  id: string;
  key: string;
  /**
   * The route. For `nav: "org"` it is relative to `/org/:projectId/:orgId/` (a company-mode
   * page mounts under that layout, beside the organization's own pages); otherwise absolute.
   */
  path: string;
  /** `main` = the development nav; `org` = a company-mode page with a nav row after the organization's own; `none` = by URL only. */
  nav: "main" | "org" | "none";
  admin: boolean;
  /** Built but not yet offered: kept in the manifest, reachable by URL and tests, hidden from the nav. */
  released: boolean;
  renderer: { builtin: string } | { iframe: { src: string; namespace: string } };
}

/** The pages still declared in src/module.json rather than contributed by a module. */
export const PAGES: readonly PageEntry[] = manifest.contributes["web.pages"] as PageEntry[];

/**
 * The company-mode pages of a merged table — every one the server contributed under
 * `nav: "org"` — in contribution order. The local manifest has none: the organization's own
 * six pages are the company layout's fixed children, not entries here.
 */
export function orgPagesOf(pages: readonly PageEntry[]): PageEntry[] {
  return pages.filter((p) => p.nav === "org" && p.released);
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
      nav: page.nav === "main" || page.nav === "org" ? page.nav : "none",
      admin: page.admin === true,
      released: page.released !== false,
      renderer,
    });
    keys.add(page.key);
  }
  return out;
}
