/**
 * What a page that opens in the App Center's window (page-table.ts `windowFrameOf`) answers at its
 * own address: its `path` and every address under it lead into the window, replacing the history
 * entry, with the rest of the path and the query as the window's `at`. So `/reports` opens
 * `/apps?app=system_agent/reports`, and `/reports/r1?tab=a` opens it at `/r1?tab=a`.
 *
 * The replaced entry carries no "opened from here" flag: the address was typed, linked or
 * reloaded, so leaving the window replaces it with the grid rather than stepping back
 * (lib/app-window-address.ts).
 */
import { Navigate, useLocation } from "react-router";
import { windowAddress } from "../lib/app-window-address";
import { systemAppKey } from "../lib/system-apps";
import { routeSegmentsOf } from "./route-under";

/**
 * The location inside the app that `pathname` and `search` name, under the page's route
 * `pattern`: the path past the pattern's own segments (a parameter counts as one), then the query.
 */
export function innerAtOf(pattern: string, pathname: string, search: string): string {
  const stem = routeSegmentsOf(pattern).filter((segment) => segment !== "*").length;
  const rest = routeSegmentsOf(pathname).slice(stem);
  return `/${rest.join("/")}${search}`;
}

/** The page component of a page with this key and route that opens in the window. */
export function windowRedirectFor(key: string, pattern: string) {
  return function WindowRedirect() {
    const { pathname, search } = useLocation();
    return (
      <Navigate
        replace
        to={windowAddress(systemAppKey(key), innerAtOf(pattern, pathname, search))}
      />
    );
  };
}
