/**
 * WebApp's public face: the page table (the modules' pages and the server's) and the layers,
 * for whatever renders under WebApp's root, and the rest of what the server contributes.
 */
import { webAppDeps, type WebAppLayer } from "./deps";

export type { PageData, ServerPage, WebAppPage } from "./page-table";
export { navPagesOf, pageTitle } from "./page-table";
export { useContributions, useWebAppPages } from "./contributions";

/** The contributed layers, by `order`: the app layout mounts each once, beside the page. */
export function useWebAppLayers(): readonly WebAppLayer[] {
  return webAppDeps.useDeps().layers;
}
