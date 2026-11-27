/**
 * Where a framed page is inside itself, kept in the address of the view that shows it: `at`, the
 * path and query inside the app (lib/app-window-address.ts). The frame's own end is
 * lib/frame-location.ts; what the hooks here return is what it takes, plus `place()`, where the
 * page is as last heard, for a caller that hands the place on (opening or leaving full screen).
 * Every app drawn in an iframe goes through them — a system app's page and an Agent workbench's —
 * so both kinds of window agree.
 *
 * An App Center window (`useWindowFrameAddress`):
 * - While the window is in front, the page's own moves (`penguin:location`) replace the address's
 *   `at`, never adding a history entry; an `at` the address gains on its own (Back or Forward onto
 *   another entry, a pasted address) is sent to the page, which goes there without reloading.
 * - An address that names the app but no `at` — its tile, a running list, a link to the app —
 *   asks nothing of the page: the window comes back where the page is, and the address is given
 *   that place.
 * - The page's `penguin:navigate` takes the viewer there, which leaves the window minimized with
 *   the app still running, so Back (or its tile) brings it back. A minimized window's page cannot
 *   move the viewer: only the window in front speaks for itself.
 * - A window that switches to another of its app's pages (a workbench of several) starts that one
 *   at its root, and the address forgets the place the page before it was at.
 *
 * A full page (`useFullPageFrameAddress`): its own route's `?at=` is the place, the page's moves
 * replace it in the same history entry, and `penguin:navigate` goes where it says.
 */
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { searchWithAt, WINDOW_AT_PARAM, windowAt, windowInFront } from "./app-window-address";
import type { FrameLocation } from "./frame-location";
import { innerLocationOf } from "./frame-messages";

export interface FrameAddress extends Required<FrameLocation> {
  /** Where the page is, as last heard: where it started, then what it said. */
  place: () => string;
}

/**
 * The window of the app `appKey` (its `?app=` key), showing its page `page`: any name that tells
 * the app's pages apart, undefined while none is shown yet; an app of one page passes none.
 */
export function useWindowFrameAddress(appKey: string, page?: string): FrameAddress {
  const location = useLocation();
  const navigate = useNavigate();
  const shown = windowInFront(location) === appKey;
  /** What the address says of the page: only while this window is the one in front. */
  const addressed = shown ? windowAt(location) : null;
  const current = useRef(addressed ?? "/");

  // Another page of the app than the one shown before (the first one shown is no switch): what the
  // address still says was the page before's place, until the address moves on.
  const scope = useRef<{ page: string | undefined; stale: string | null }>({ page, stale: null });
  if (page !== undefined && page !== scope.current.page) {
    if (scope.current.page !== undefined) {
      scope.current.stale = addressed;
      current.current = "/";
    }
    scope.current.page = page;
  }
  if (scope.current.stale !== null && addressed !== scope.current.stale) scope.current.stale = null;
  /** What the address asks of the page. */
  const asked = scope.current.stale === null ? addressed : null;
  if (asked !== null) current.current = asked;

  const here = useRef({ location, shown });
  here.current = { location, shown };
  /** Gives the address of the window in front the page's place, in the same history entry. */
  const writeAt = useCallback(
    (at: string | null) => {
      const { location: now } = here.current;
      const search = searchWithAt(now.search, at);
      if (search === now.search) return;
      // A full-screen dock uses the standalone public URL while keeping its actual
      // window alive. Keep both addresses on the location the frame just reported.
      const mask = now.mask && { ...now.mask, search: searchWithAt(now.mask.search, at) };
      void navigate({ pathname: now.pathname, search }, { replace: true, state: now.state, mask });
    },
    [navigate],
  );

  // Brought to the front by an address that asks nothing: it says where the page already is.
  // Switched to another page: the address no longer names the page before's place.
  const stale = scope.current.stale !== null;
  useEffect(() => {
    if (!shown) return;
    if (stale) writeAt(null);
    else if (asked === null && current.current !== "/") writeAt(current.current);
  }, [shown, asked, stale, writeAt]);

  const onLocation = useCallback(
    (at: string) => {
      current.current = at;
      if (here.current.shown) writeAt(at);
    },
    [writeAt],
  );
  const onNavigate = useCallback(
    (to: string) => {
      if (here.current.shown) void navigate(to);
    },
    [navigate],
  );
  const place = useCallback(() => current.current, []);
  return { at: asked, onLocation, onNavigate, place };
}

/** A full page, whose own route carries the place as `?at=`. */
export function useFullPageFrameAddress(): FrameAddress {
  const location = useLocation();
  const navigate = useNavigate();
  const asked = innerLocationOf(new URLSearchParams(location.search).get(WINDOW_AT_PARAM));
  const current = useRef(asked ?? "/");
  if (asked !== null) current.current = asked;
  const here = useRef(location);
  here.current = location;

  const onLocation = useCallback(
    (at: string) => {
      current.current = at;
      const now = here.current;
      const search = searchWithAt(now.search, at);
      if (search !== now.search)
        void navigate({ pathname: now.pathname, search }, { replace: true, state: now.state });
    },
    [navigate],
  );
  const onNavigate = useCallback((to: string) => void navigate(to), [navigate]);
  const place = useCallback(() => current.current, []);
  return { at: asked, onLocation, onNavigate, place };
}
