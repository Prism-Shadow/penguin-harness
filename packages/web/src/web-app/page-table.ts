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
import { routeUnder } from "./route-under";

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
  /** A main-nav page's row, or a system app's tile: its name in English and in Chinese, and its glyph's name in the UI package's icon registry (`ICONS`). */
  title?: string;
  titleZh?: string;
  icon?: string;
  /**
   * The key of the page this one sits under: the nav draws it as an indented row below that
   * page (lib/nav-pages.ts). One level only — see parentedPagesOf.
   */
  parent?: string;
  /**
   * Makes the page a system app of the system Agent: an App Center tile named and drawn by
   * `title` / `titleZh` / `icon`, shown to whom `admin` allows, placed by `order` among the system
   * apps (lib/system-apps.ts). It opens `path` as a page, or in the App Center's window when the
   * server contributed it as an iframe (windowFrameOf). A page without a `title` is no app.
   */
  app?: { order: number };
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
  /**
   * The web module whose server module this page waits for (lib/module-gate.ts): the table
   * leaves it out while that module is not running. Absent on every other page.
   */
  gatedBy?: string;
}

/** A page the server contributed: the renderer it named stays beside the component, for the readers that key on it. */
export type ServerPage = WebAppPage & { renderer: RendererRef };

/**
 * The document a page opens in the App Center's window, or null for a page that opens as a page.
 * A page the server contributed, drawn by an iframe, offered, outside company mode and a system
 * app (`app`) opens in the window: its tile opens the window, and its `path` and every address
 * under it lead there (web-app/window-redirect.tsx). Every other page, the modules' own system
 * apps among them, opens at its path.
 */
export function windowFrameOf(
  page: Pick<WebAppPage, "renderer" | "app" | "nav" | "released">,
): string | null {
  const { renderer } = page;
  if (page.app === undefined || !page.released || page.nav === "org" || renderer === undefined)
    return null;
  return "iframe" in renderer ? renderer.iframe.src : null;
}

/** The route a page is mounted at: one that opens in the window answers every address under it. */
export function routePathOf(
  page: Pick<WebAppPage, "path" | "renderer" | "app" | "nav" | "released">,
): string {
  if (windowFrameOf(page) === null || page.path.endsWith("/*")) return page.path;
  return `${page.path.replace(/\/+$/, "")}/*`;
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

/**
 * The table without the pages the given keys name, nor the pages whose route lies under one of
 * theirs (route-under.ts: `/agents/:agentId` lies under `/agents`, and a trailing splat answers
 * the rest of the URL), so removing `agents` takes `agent-settings` with it but not the other
 * way round: what lives under a page's URL belongs to that page, and a removal names
 * the page a user sees, not the routes behind it. A page at "/" or at a bare splat (home, `*`)
 * takes only itself. A page that answers one of HOME_PATHS stays whatever names it. Keys naming
 * no page are ignored; pages under a removed one by `parent` are left to parentedPagesOf, which
 * runs after this.
 */
export function removedPagesOf(
  pages: readonly WebAppPage[],
  keys: readonly string[],
): readonly WebAppPage[] {
  if (keys.length === 0) return pages;
  const removed = pages.filter((p) => keys.includes(p.key)).map((p) => p.path);
  if (removed.length === 0) return pages;
  return pages.filter((p) => {
    if (HOME_PATHS.some((home) => matchPath(p.path, home) !== null)) return true;
    if (keys.includes(p.key)) return false;
    return !removed.some((root) => routeUnder(p.path, root));
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
