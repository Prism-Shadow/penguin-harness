import type { NavigateFunction } from "react-router";

/**
 * The App Center's route. A workbench opened full page from the App Center carries it, with the
 * query of the view it left (`?app=…` for an app's window), as its `returnTo`, and the full
 * page's exit goes back there rather than to Chat.
 */
export const APP_CENTER_PATH = "/apps";

/** Whether a full page's `returnTo` is the App Center: its grid, or one of its windows. */
export function isAppCenterPath(path: unknown): path is string {
  return typeof path === "string" && /^\/apps(?:\?[^#]*)?$/.test(path);
}

/** TypeScript's DOM library currently types history entries but not window.navigation. */
function hostNavigation() {
  return (
    window as Window & {
      navigation?: {
        currentEntry: { index: number } | null;
        entries(): readonly Pick<NavigationHistoryEntry, "url" | "key" | "sameDocument">[];
        traverseTo(key: string): { finished: Promise<unknown> };
      };
    }
  ).navigation;
}

export function openAppCenterFullScreen(
  navigate: NavigateFunction,
  path: string,
  returnTo: string,
): void {
  // On older browsers, expanding an already open window must reuse its host entry. Otherwise
  // Back after closing both views could reopen the old window beneath the full-screen page.
  const expandInPlace =
    !hostNavigation()?.currentEntry &&
    new URL(returnTo, window.location.href).searchParams.has("app");
  void navigate(path, { state: { returnTo }, replace: expandInPlace });
}

/** The Navigation API lists only host entries. history.back() can instead step through
 * any iframe's pages, including cross-origin apps whose history we cannot inspect. */
export function returnToAppCenter(navigate: NavigateFunction, path: string): void {
  const navigation = hostNavigation();
  const start = window.location.href;
  const previous =
    navigation?.currentEntry && navigation.entries()[navigation.currentEntry.index - 1];
  if (navigation && previous?.sameDocument && previous.url === new URL(path, start).href) {
    void navigation.traverseTo(previous.key).finished.catch(() => {
      if (window.location.href === start) void navigate(path, { replace: true });
    });
  } else {
    // Direct link, or a browser without the Navigation API: close to the known host route.
    void navigate(path, { replace: true });
  }
}
