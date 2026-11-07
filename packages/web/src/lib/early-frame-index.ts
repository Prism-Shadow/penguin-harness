import { webAppDeps, type WebAppLayer } from "./early-frame-deps";

import type { WebAppPage } from "./early-frame-page-table";

export type { PageData, PageEntry, WebAppPage } from "./early-frame-page-table";
export { navPagesOf, orgPagesOf } from "./early-frame-page-table";
export { ContributedPage } from "./early-frame-contributed-page";

/** Every page the modules contributed, by `order`. */
export function useWebAppPages(): readonly WebAppPage[] {
  return webAppDeps.useDeps().pages;
}

/** The contributed layers, by `order`: the app layout mounts each once, beside the page. */
export function useWebAppLayers(): readonly WebAppLayer[] {
  return webAppDeps.useDeps().layers;
}
