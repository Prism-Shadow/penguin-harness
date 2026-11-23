/**
 * Leaving a view that hosts an embedded app, whose iframe may have added entries to the joint
 * session history: an App Center window, an open folder over it, a full page opened from either.
 *
 * `history.back()` steps through the iframe's own pages first, cross-origin apps included, whose
 * history the host cannot inspect, so one step back can leave the reader inside the app. The
 * Navigation API lists only the host's own entries, so a return traverses straight to the host
 * entry before the current one when that is where the reader is going: a known path, or, with
 * `stepBack`, whatever entry the current one was pushed on top of. Otherwise (a direct link, a
 * reload onto a view nothing pushed, a browser without the Navigation API) the current entry is
 * replaced with the destination's route.
 *
 * Without the Navigation API that replace is all the host can do: the iframe's entries stay
 * behind it, so Back afterwards passes through them before it leaves. Chromium and the desktop
 * app have the API.
 */
import type { NavigateFunction } from "react-router";

/** The Navigation API, which TypeScript's DOM library does not type on `window` yet. */
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

/**
 * Returns from the current view to `to`: back to the previous host entry when it is `to`, or
 * when `stepBack` says the current entry was pushed on top of the one to return to; else the
 * current entry becomes `to`.
 */
export function returnToHostEntry(
  navigate: NavigateFunction,
  to: string,
  { stepBack = false }: { stepBack?: boolean } = {},
): void {
  const navigation = hostNavigation();
  const start = window.location.href;
  const previous =
    navigation?.currentEntry && navigation.entries()[navigation.currentEntry.index - 1];
  if (
    navigation &&
    previous?.sameDocument &&
    (stepBack || previous.url === new URL(to, start).href)
  ) {
    void navigation.traverseTo(previous.key).finished.catch(() => {
      // Traversal can be refused (another navigation won); land on the route unless one did.
      if (window.location.href === start) void navigate(to, { replace: true });
    });
    return;
  }
  void navigate(to, { replace: true });
}

/**
 * Opens a full page whose exit returns to `returnTo`. Opened from a window (`fromWindow`) in a
 * browser that cannot traverse host entries, it takes the window's entry rather than pushing
 * one: its exit replaces the entry it is on, and a window entry left beneath would come back on
 * the next Back.
 */
export function openFullPage(
  navigate: NavigateFunction,
  path: string,
  returnTo: string,
  { fromWindow }: { fromWindow: boolean },
): void {
  const replace = fromWindow && !hostNavigation()?.currentEntry;
  void navigate(path, { state: { returnTo }, replace });
}
