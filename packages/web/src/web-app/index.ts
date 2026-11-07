/**
 * The shell's public face: the page table, for whatever renders under WebApp's root, and how
 * a server-contributed page is drawn.
 */
import { webAppDeps } from "./deps";
import type { WebAppPage } from "./page-table";

export type { PageData, PageEntry, WebAppPage } from "./page-table";
export { navPagesOf, orgPagesOf } from "./page-table";
export { ContributedPage } from "./contributed-page";

/** Every page the modules contributed, by `order`. */
export function useWebAppPages(): readonly WebAppPage[] {
  return webAppDeps.useDeps().pages;
}
