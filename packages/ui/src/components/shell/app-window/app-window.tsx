/**
 * Windows that share one area of the page, shown one at a time: the Chat window and a Workbench
 * window under the chat page's tab strip, each a sibling of the others in a `WindowStack`.
 *
 * A window is its own stacking context (`isolation: isolate`), so the layers inside it — sticky
 * rows, a dock lifted to fullscreen, its resize handles, an in-place menu — order only among
 * themselves and can never paint over the window shown beside it, the navigation column or an
 * overlay in the portal root (layers.css). A window that is not shown stays mounted and laid out
 * at the area's size, so nothing in it reflows, refits or loses its scroll, but it is neither
 * painted nor reachable: `visibility: hidden` takes it off the screen and out of hit testing, and
 * `inert` takes it out of the focus order and the accessibility tree. What it holds learns that it
 * is off screen through `useWindowShown`, for the things a hidden ancestor does not stop on its
 * own: a page laid over a dock slot by coordinates, a poll, a refetch on return.
 */
import { createContext, useContext } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";

const WindowShownContext = createContext(true);

/**
 * Whether the window this renders in is on screen; true outside any window, where nothing can be
 * hidden behind another.
 */
export function useWindowShown(): boolean {
  return useContext(WindowShownContext);
}

/** The area the windows share: each window covers it whole. */
export function WindowStack({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div {...rest} className={`relative min-h-0 flex-1 ${className}`}>
      {children}
    </div>
  );
}

export function AppWindow({
  shown,
  className = "",
  children,
  ref,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  /** On screen; a window that is not stays mounted, unpainted and inert. */
  shown: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  return (
    <WindowShownContext.Provider value={shown}>
      <div
        ref={ref}
        {...rest}
        data-window=""
        data-shown={shown}
        inert={!shown}
        className={`absolute inset-0 isolate flex flex-col ${shown ? "" : "invisible"} ${className}`}
      >
        {children}
      </div>
    </WindowShownContext.Provider>
  );
}
