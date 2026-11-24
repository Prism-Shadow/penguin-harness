/**
 * The theme's page transition, played on a change of page and on nothing else.
 *
 * A page is a row of the page table (page-table.ts), the same rows ShellRoutes mounts, so a
 * move inside one page keeps it still: sending the first message of a draft
 * (`/chat/new` → `/chat/<id>`), switching conversations, and company mode's own sub-routes
 * under `/org/*` all stay on one page. Only shell pages take part: a bare page has no shell
 * around it to keep live.
 *
 * The transition itself is the router's native `viewTransition`, so the router still owns
 * blockers, history traversal and interrupting a transition with a later navigation.
 */
import {
  matchRoutes,
  parsePath,
  resolvePath,
  type DataRouter,
  type RouteObject,
  type To,
} from "react-router";
import type { WebAppPage } from "./page-table";

type PageRow = Pick<WebAppPage, "id" | "path" | "frame">;

/**
 * The shell page `pathname` shows, or null when it shows none. Every page is ranked, the bare
 * ones too, as the router ranks them: a bare page's path would otherwise fall to the shell's
 * catch-all home page.
 */
function shellPageAt(pages: readonly PageRow[], pathname: string): string | null {
  const routes: RouteObject[] = pages.map((page) => ({ id: page.id, path: page.path }));
  const id = matchRoutes(routes, pathname)?.at(-1)?.route.id;
  const page = pages.find((row) => row.id === id);
  return page?.frame === "shell" ? page.id : null;
}

/** Whether going from `from` to `to` leaves one shell page for another. */
export function isPageChange(pages: readonly PageRow[], from: string, to: string): boolean {
  if (from === to) return false;
  const before = shellPageAt(pages, from);
  const after = shellPageAt(pages, to);
  return before !== null && after !== null && before !== after;
}

let activeNavigate: ((to: string) => void) | null = null;

/** Registers the mounted router's `navigate` for the plugin host (`navigateApp`). */
export function setActiveNavigator(next: ((to: string) => void) | null): () => void {
  activeNavigate = next;
  return () => {
    if (activeNavigate === next) activeNavigate = null;
  };
}

/** Navigates the active router to `to` (falls back to `history.pushState` when unmounted). */
export function navigateApp(to: string): void {
  if (activeNavigate !== null) {
    activeNavigate(to);
    return;
  }
  if (typeof window !== "undefined") {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

/**
 * Patches `router.navigate` to ask for a view transition on a change of page, when the browser
 * can play one, the reader has not turned motion off, and the theme gives the page a duration.
 * `pages` returns the page table as it stands, contributed pages included.
 */
export function withPageTransitions(
  router: DataRouter,
  pages: () => readonly PageRow[],
): DataRouter {
  const navigate = router.navigate.bind(router);
  router.navigate = (to: To | number | null, options?: Parameters<DataRouter["navigate"]>[1]) => {
    if (typeof to === "number") return navigate(to);
    const destination = typeof to === "string" ? parsePath(to).pathname : to?.pathname;
    const current = router.state.location.pathname;
    const path = destination ? resolvePath(destination, current).pathname : current;
    const doc = router.window?.document;
    const enabled =
      isPageChange(pages(), current, path) &&
      typeof doc?.startViewTransition === "function" &&
      CSS.supports("selector(:active-view-transition)") &&
      !router.window?.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      doc.documentElement.dataset.motion !== "reduced" &&
      doc.querySelector("[data-page-viewport]") !== null &&
      parseFloat(getComputedStyle(doc.documentElement).getPropertyValue("--ui-page-duration")) > 0;
    return navigate(to, {
      ...options,
      viewTransition: enabled && options?.viewTransition !== false,
    });
  };
  activeNavigate ??= (to) => {
    void router.navigate(to);
  };
  return router;
}
