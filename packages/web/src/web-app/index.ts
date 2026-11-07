/**
 * The shell's public face: the page table and the layers, for whatever renders under the
 * shell's root, and how a server-contributed page is drawn.
 */
import { webAppDeps, type WebAppLayer } from "./deps";

import type { WebAppPage } from "./page-table";

export type { PageData, PageEntry, WebAppPage } from "./page-table";
export { navPagesOf, orgPagesOf } from "./page-table";
export { ContributedPage } from "./contributed-page";

/** Every page the modules contributed, by `order`. */
export function useWebAppPages(): readonly WebAppPage[] {
  return webAppDeps.useDeps().pages;
}

/** The contributed layers, by `order`: the app layout mounts each once, beside the page. */
export function useWebAppLayers(): readonly WebAppLayer[] {
  return webAppDeps.useDeps().layers;
}
