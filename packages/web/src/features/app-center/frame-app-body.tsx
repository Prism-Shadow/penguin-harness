/**
 * The body of the window of an app a server module draws in an iframe (a system app with a
 * `frame`): the page's document in the frame every contributed page uses (lib/page-frame.tsx),
 * and the window's address kept in step with where the page is inside itself.
 *
 * - While the window is in front, the page's own moves (`penguin:location`) replace the address's
 *   `at`, never adding a history entry; an `at` the address gains on its own (Back or Forward onto
 *   another entry, a pasted address) is sent to the page, which goes there without reloading.
 * - An address that names the app but no `at` — its tile, a running list, a link to the app —
 *   asks nothing of the page: the window comes back where the page is, and the address is given
 *   that place.
 * - The page's `penguin:navigate` takes the viewer there, which leaves the window minimized with
 *   the app still running, so Back (or its tile) brings it back. A minimized window's page cannot
 *   move the viewer: only the window in front speaks for itself.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { searchWithAt, windowAt, windowInFront } from "../../lib/app-window-address";
import { PageFrame } from "../../lib/page-frame";

export function FrameAppBody({
  appKey,
  projectId,
  src,
  title,
}: {
  /** The window's key in the address (`?app=`). */
  appKey: string;
  projectId: string;
  src: string;
  title: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const shown = windowInFront(location) === appKey;
  /** What the address asks of the page: only while this window is the one in front. */
  const asked = shown ? windowAt(location) : null;
  /** Where the page is, as last heard: where it started, then what it said. */
  const current = useRef(asked ?? "/");
  if (asked !== null) current.current = asked;

  const here = useRef({ location, shown });
  here.current = { location, shown };
  /** Gives the address of the window in front the page's place, in the same history entry. */
  const writeAt = (at: string) => {
    const { location: now } = here.current;
    const search = searchWithAt(now.search, at);
    if (search === now.search) return;
    // A full-screen dock uses the standalone public URL while keeping its actual
    // window alive. Keep both addresses on the location the frame just reported.
    const mask = now.mask && { ...now.mask, search: searchWithAt(now.mask.search, at) };
    void navigate({ pathname: now.pathname, search }, { replace: true, state: now.state, mask });
  };

  // Brought to the front by an address that asks nothing: it says where the page already is.
  useEffect(() => {
    if (shown && asked === null && current.current !== "/") writeAt(current.current);
  }, [shown, asked]);

  return (
    <PageFrame
      src={src}
      title={title}
      projectId={projectId}
      at={asked}
      onLocation={(at) => {
        current.current = at;
        if (here.current.shown) writeAt(at);
      }}
      onNavigate={(to) => {
        if (here.current.shown) void navigate(to);
      }}
    />
  );
}
