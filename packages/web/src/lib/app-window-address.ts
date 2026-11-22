/**
 * How the address names the App Center's window in front: `?app=<agentId>/<workbenchId>` on the
 * App Center's route. Opening a window from the grid, or bringing one back from another surface,
 * pushes that entry with a flag and the view it was opened over, so leaving the window (minimize,
 * close) returns to that view: a step back over the host's own entries where the browser can
 * traverse them (lib/host-history.ts: the app's iframe pages are skipped), else a replace with
 * that view's route, and Forward brings the window back. A window reached any other way (a link,
 * a reload) leaves by replacing its entry with the grid's.
 *
 * An app drawn by a contributed page (a system app's iframe) keeps its own location in the
 * address too, as `&at=<path and query inside the app>`: what a reload, a link or Forward brings
 * it back to. The app's root ("/") is written as no `at` at all.
 */
import type { Location, NavigateFunction } from "react-router";
import { APP_CENTER_PATH } from "./app-center-path";
import { returnToHostEntry } from "./host-history";

/** The query that names the app in front. */
export const WINDOW_PARAM = "app";

/** The query that holds the location inside the app in front, for an app that keeps one. */
export const WINDOW_AT_PARAM = "at";

interface WindowEntryState {
  appCenterWindow?: boolean;
  /** The view the window was opened over, path and query: where leaving it returns. */
  returnTo?: string;
}

/** The history state pushed with a window's address by whatever opened it over `returnTo`. */
export function windowEntryState(returnTo: string): WindowEntryState {
  return { appCenterWindow: true, returnTo };
}

/** The location inside an app as the address writes it: its root is no location at all. */
function writtenAt(at: string | null | undefined): string | null {
  return at === null || at === undefined || at === "" || at === "/" ? null : at;
}

/** The query that puts the app `key` in front, at `at` inside it when it keeps a location. */
export function windowSearch(key: string, at?: string | null): string {
  const params = new URLSearchParams({ [WINDOW_PARAM]: key });
  const written = writtenAt(at);
  if (written !== null) params.set(WINDOW_AT_PARAM, written);
  return `?${params.toString()}`;
}

/** The whole address of the app `key`'s window, at `at` inside it. */
export function windowAddress(key: string, at?: string | null): string {
  return `${APP_CENTER_PATH}${windowSearch(key, at)}`;
}

/** The app whose window the address puts in front: on the App Center only, else none. */
export function windowInFront(location: Pick<Location, "pathname" | "search">): string | null {
  if (location.pathname !== APP_CENTER_PATH) return null;
  return new URLSearchParams(location.search).get(WINDOW_PARAM);
}

/** The location the address asks of the app in front; null when it names none (its root). */
export function windowAt(location: Pick<Location, "pathname" | "search">): string | null {
  if (location.pathname !== APP_CENTER_PATH) return null;
  return writtenAt(new URLSearchParams(location.search).get(WINDOW_AT_PARAM));
}

/** `search` with its `at` set to `at`, every other parameter kept in place. */
export function searchWithAt(search: string, at: string | null): string {
  const params = new URLSearchParams(search);
  const written = writtenAt(at);
  if (written === null) params.delete(WINDOW_AT_PARAM);
  else params.set(WINDOW_AT_PARAM, written);
  const next = params.toString();
  return next === "" ? "" : `?${next}`;
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
  params.delete(WINDOW_AT_PARAM);
  const search = params.toString();
  const grid = search === "" ? APP_CENTER_PATH : `${APP_CENTER_PATH}?${search}`;
  returnToHostEntry(navigate, state?.returnTo ?? grid, {
    stepBack: state?.appCenterWindow === true,
  });
}
