/** WebApp's public face: the page table, for whatever renders under WebApp's root. */
import { webAppDeps } from "./deps";
import type { WebAppPage } from "./page-table";

export type { PageData, WebAppPage } from "./page-table";
export { navPagesOf } from "./page-table";

/** Every page the modules contributed, by `order`. */
export function useWebAppPages(): readonly WebAppPage[] {
  return webAppDeps.useDeps().pages;
}
