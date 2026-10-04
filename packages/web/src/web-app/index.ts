/**
 * WebApp's public face: the page table and the layers, for whatever renders under the
 * shell's root, and how a server-contributed page is drawn.
 */
import { webAppDeps, type WebAppLayer } from "./deps";

export type { PageData, PageEntry, WebAppPage } from "./page-table";
export { navPagesOf, orgPagesOf, pageTitle } from "./page-table";
export { ContributedPage } from "./contributed-page";
export { useContributions, useWebAppPages } from "./contributions";

/** The contributed layers, by `order`: the app layout mounts each once, beside the page. */
export function useWebAppLayers(): readonly WebAppLayer[] {
  return webAppDeps.useDeps().layers;
}
