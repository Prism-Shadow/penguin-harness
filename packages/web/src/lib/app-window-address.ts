/**
 * How the address names the App Center's window in front: `?app=<agentId>/<workbenchId>` on the
 * App Center's route. Opening a window from the grid, or bringing one back from another surface,
 * pushes that entry with a flag and the view it was opened over, so leaving the window (minimize,
 * close) returns to that view: a step back over the host's own entries where the browser can
 * traverse them (lib/host-history.ts: the app's iframe pages are skipped), else a replace with
 * that view's route, and Forward brings the window back. A window reached any other way (a link,
 * a reload) leaves by replacing its entry with the grid's.
 */
import type { Location, NavigateFunction } from "react-router";
import { APP_CENTER_PATH } from "./app-center-path";
import { returnToHostEntry } from "./host-history";

/** The query that names the app in front. */
export const WINDOW_PARAM = "app";

interface WindowEntryState {
  appCenterWindow?: boolean;
  /** The view the window was opened over, path and query: where leaving it returns. */
  returnTo?: string;
}

/** The history state pushed with a window's address by whatever opened it over `returnTo`. */
export function windowEntryState(returnTo: string): WindowEntryState {
  return { appCenterWindow: true, returnTo };
}

/** The query that puts the app `key` in front. */
export function windowSearch(key: string): string {
  return `?${new URLSearchParams({ [WINDOW_PARAM]: key }).toString()}`;
}

/** The app whose window the address puts in front: on the App Center only, else none. */
export function windowInFront(location: Pick<Location, "pathname" | "search">): string | null {
  if (location.pathname !== APP_CENTER_PATH) return null;
  return new URLSearchParams(location.search).get(WINDOW_PARAM);
}

/** The app whose window an in-app path (`/apps?app=…`) puts in front, else none. */
export function windowOfPath(path: string): string | null {
  const at = path.indexOf("?");
  return windowInFront({
    pathname: at === -1 ? path : path.slice(0, at),
    search: at === -1 ? "" : path.slice(at),
  });
}

/** Leaves the window in front for the view beneath; whether the app keeps running is the caller's. */
export function leaveWindow(navigate: NavigateFunction, location: Location): void {
  const state = location.state as WindowEntryState | null;
  const params = new URLSearchParams(location.search);
  params.delete(WINDOW_PARAM);
  const search = params.toString();
  const grid = search === "" ? APP_CENTER_PATH : `${APP_CENTER_PATH}?${search}`;
  returnToHostEntry(navigate, state?.returnTo ?? grid, {
    stepBack: state?.appCenterWindow === true,
  });
}
