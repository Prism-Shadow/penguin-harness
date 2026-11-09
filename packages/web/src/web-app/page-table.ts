/**
 * The web app's pages. Each one is a contribution to WebApp's `pages` slot (web-app/module.ts):
 * the feature that owns it declares its route, its frame, whether it sits in the main nav,
 * whether the server refuses it to non-admins, whether it is offered yet, and its place, and
 * binds the component that draws it. `pageTableOf` turns the contributions into the table the
 * router mounts and the sidebar derives its nav group from. Pages the server's modules and
 * plugins contribute are folded in after them by web-app/contributions.tsx.
 */
import type { ComponentType } from "react";
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
