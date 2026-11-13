/** Compatibility hook: all org consumers share WebApp's one contribution store. */
import { useWebAppPages } from "../../lib/web-app-pages";
export function orgPagesOf(pages: ReturnType<typeof useWebAppPages>) {
  return pages.filter((page) => page.nav === "org");
}
export function useOrgPages() {
  return orgPagesOf(useWebAppPages());
}
