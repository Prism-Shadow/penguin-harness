/**
 * How the address names the App Center's window in front: `?app=<agentId>/<workbenchId>` on the
 * App Center's route. Opening a window from the grid, or bringing one back from another surface,
 * pushes that entry with a flag, so leaving the window (minimize, close) is a step back to the
 * entry it came from rather than a new one, and Forward brings the window back; a window reached
 * any other way (a link, a reload) leaves by replacing its entry with the grid's.
 */
import type { Location, NavigateFunction } from "react-router";
import { APP_CENTER_PATH } from "./app-center-path";

/** The query that names the app in front. */
export const WINDOW_PARAM = "app";

interface WindowEntryState {
  appCenterWindow?: boolean;
}

/** The history state pushed with a window's address by whatever opened it. */
export const WINDOW_ENTRY_STATE: WindowEntryState = { appCenterWindow: true };

/** The query that puts the app `key` in front. */
export function windowSearch(key: string): string {
  return `?${new URLSearchParams({ [WINDOW_PARAM]: key }).toString()}`;
}

/** The app whose window the address puts in front: on the App Center only, else none. */
export function windowInFront(location: Pick<Location, "pathname" | "search">): string | null {
  if (location.pathname !== APP_CENTER_PATH) return null;
  return new URLSearchParams(location.search).get(WINDOW_PARAM);
}

/** Leaves the window in front for the grid; whether the app keeps running is the caller's. */
export function leaveWindow(navigate: NavigateFunction, location: Location): void {
  if ((location.state as WindowEntryState | null)?.appCenterWindow === true) {
    void navigate(-1);
    return;
  }
  const params = new URLSearchParams(location.search);
  params.delete(WINDOW_PARAM);
  const search = params.toString();
  void navigate(
    { pathname: APP_CENTER_PATH, search: search === "" ? "" : `?${search}` },
    { replace: true },
  );
}
