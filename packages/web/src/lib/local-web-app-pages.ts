/** Local page table supplied once at the existing WebApp root. No remote store or fetch. */
import { createDeps } from "./module-deps";
import type { WebAppPage } from "./local-page-table";
export const localWebAppPages = createDeps<readonly WebAppPage[]>();
export function useWebAppPages(): readonly WebAppPage[] {
  return localWebAppPages.useDeps();
}
