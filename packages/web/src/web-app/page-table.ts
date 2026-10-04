/**
 * The web app's pages. Each one is a contribution to WebApp's `pages` slot (web-app/module.ts):
 * the feature that owns it declares its route, its frame, whether it sits in the main nav,
 * whether the server refuses it to non-admins, whether it is offered yet, and its place, and
 * binds the component that draws it. `pageTableOf` turns the contributions into the table the
 * router mounts and the sidebar derives its nav group from. Pages the server's modules and
 * plugins contribute are folded in after them by web-app/contributions.tsx, which also drops the
 * pages the server's removals name (removedPagesOf).
 */
import type { ComponentType } from "react";
import { matchPath } from "react-router";
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import type { RendererRef } from "@prismshadow/penguin-server/api";

/** One page as its feature declares it: the data half of a `pages` contribution. */
export interface PageData {
  key: string;
  path: string;
  /** "bare" mounts outside the app shell (no sidebar, no Project context): the terminal, a workflow's app page. */
  /** Keep the published layout discriminator; it is not a module address or terminal shell. */
  frame: "shell" | "bare";
  nav: "main" | "none";
  admin: boolean;
  /** Built but not yet offered: reachable by URL and tests, hidden from the nav. */
  released: boolean;
  /** The page's place in the table, and so in the nav. */
  order: number;
  /** A main-nav page's row: its name in English and in Chinese, and its glyph's name in the UI package's icon registry (`ICONS`). */
  title?: string;
  titleZh?: string;
  icon?: string;
  /**
   * The key of the page this one sits under: the nav draws it as an indented row below that
   * page (web-app/sidebar/nav-state.ts). One level only — see parentedPagesOf.
   */
  parent?: string;
}

/** A page with the component its feature bound, or the one a server-contributed page's renderer resolved to. */
export interface WebAppPage extends Omit<PageData, "nav"> {
  id: string;
  /**
   * `org`: a company-mode page the server contributed, with no row in the main nav; its path is
   * relative to an organization (features/company/org-routes.tsx mounts it there).
   */
  nav: PageData["nav"] | "org";
  Component: ComponentType;
  /** The renderer a server-contributed page named; absent on the modules' own pages. */
  renderer?: RendererRef;
}

/** A page the server contributed: the renderer it named stays beside the component, for the readers that key on it. */
export type ServerPage = WebAppPage & { renderer: RendererRef };

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

/**
 * The table with every page whose `parent` cannot hold it dropped — from the nav and from the
 * routes alike, so a page never shows up detached from where it belongs: a parent that is not
 * in the table (its plugin is gone, or the page was never there), a parent that itself sits
 * under another page (one level only; the child is refused, its parent stays), or the page's
 * own key.
 */
export function parentedPagesOf(pages: readonly WebAppPage[]): readonly WebAppPage[] {
  if (pages.every((p) => p.parent === undefined)) return pages;
  const byKey = new Map(pages.map((p) => [p.key, p]));
  return pages.filter((p) => {
    if (p.parent === undefined) return true;
    const parent = byKey.get(p.parent);
    return parent !== undefined && parent !== p && parent.parent === undefined;
  });
}

/**
 * Where home leads: company mode's `home` page (path `*`, features/company/home-redirect.tsx)
 * answers `/`, a signed-in /login and every path nothing else matches by sending it to the
 * effective mode's home — development mode's conversations or company mode's organizations
 * (features/company/company-nav.ts `homePath`, which test/page-removal.test.ts holds to this
 * list). The pages that answer these paths, the `*` page included, are the ones no removal can
 * take away: without them home would lead to a path that falls to home again.
 */
export const HOME_PATHS: readonly string[] = ["/chat", "/org"];

/** A route pattern's segments: "/benchmark/:benchmarkId" → ["benchmark", ":benchmarkId"]. */
const segmentsOf = (path: string) => path.split("/").filter((s) => s !== "");

/**
 * The table without the pages the given keys name, nor the pages whose route lies under one of
 * theirs — whose pattern starts with every segment of the removed page's pattern, so removing
 * `benchmark` (/benchmark) takes `benchmark-detail` (/benchmark/:benchmarkId) with it but not
 * the other way round: what lives under a page's URL belongs to that page, and a removal names
 * the page a user sees, not the routes behind it. A page at "/" takes only itself. A page that
 * answers one of HOME_PATHS stays whatever names it. Keys naming no page are ignored; pages
 * under a removed one by `parent` are left to parentedPagesOf, which runs after this.
 */
export function removedPagesOf(
  pages: readonly WebAppPage[],
  keys: readonly string[],
): readonly WebAppPage[] {
  if (keys.length === 0) return pages;
  const removed = pages.filter((p) => keys.includes(p.key)).map((p) => segmentsOf(p.path));
  if (removed.length === 0) return pages;
  const under = (path: readonly string[], root: readonly string[]) =>
    root.length > 0 && root.length <= path.length && root.every((s, i) => s === path[i]);
  return pages.filter((p) => {
    if (HOME_PATHS.some((home) => matchPath(p.path, home) !== null)) return true;
    if (keys.includes(p.key)) return false;
    const path = segmentsOf(p.path);
    return !removed.some((root) => under(path, root));
  });
}

/** A page's nav name in the given language; the key stands in for a page that names none. */
export function pageTitle(
  page: Pick<PageData, "key" | "title" | "titleZh">,
  locale: "zh" | "en",
): string {
  return (locale === "zh" ? page.titleZh : page.title) ?? page.title ?? page.key;
}

/** The main nav's pages, in table order — offered or not, for any role. */
export function navPagesOf(pages: readonly WebAppPage[]): readonly WebAppPage[] {
  return pages.filter((p) => p.nav === "main");
}
