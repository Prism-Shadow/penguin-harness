/**
 * Mount state of one dock position, giving open/close its animation without giving one to
 * changes that must be instant.
 *
 * The node OUTLIVES the collapse. What a dock holds is the user's place in the work — the
 * file open in the preview, an editor draft, a running shell — and hiding a dock is a
 * gesture about the surface, not about that work, so a collapsed dock stays mounted at zero
 * size on the store's closedDockView and comes back exactly as it was. It unmounts only
 * when there is nothing left to keep (no tabs at all).
 *
 * The store's dockViews() only lists OPEN docks, so a collapse transition needs a view for
 * the frames it plays over: the hook keeps the LAST OPEN view mounted (open=false, sliding
 * to zero) for the transition's duration, which is also what carries a dock whose last tab
 * just closed through its exit. Changes the store marks instant (scope switches, cross-dock
 * moves — see instantVersion) skip the animation in both directions.
 *
 * The animate/linger decision is frozen AT RENDER TIME of the open/close flip (a ref
 * adjusted during render — deterministic for a given store state, so a re-render replays
 * it identically): an effect would decide only after the flip already painted, which for
 * a close means the transition would start a frame late.
 */
import { useEffect, useRef, useState } from "react";
import type { DockView } from "./dock-state";
import { instantVersion } from "./dock-state";

/**
 * The one duration of the dock choreography: the expand and collapse transitions and the
 * exit linger all use it. The `duration-200` Tailwind classes in dock-panel.tsx must
 * match it; CSS cannot read a JS constant.
 */
export const DOCK_TRANSITION_MS = 200;

export interface DockMount {
  /** The view to render — open, collapsing, or collapsed; null = nothing mounted. */
  view: DockView | null;
  /** False while the mounted view is collapsing on its way out, and once it is away. */
  open: boolean;
  /** Whether this open/close flip plays the transition (false for instant changes). */
  animateEntrance: boolean;
}

/**
 * @param view the store's OPEN view for this position (null when the dock is not open)
 * @param closedView what to keep mounted while it is closed (dock-state's closedDockView)
 */
export function useDockMount(view: DockView | null, closedView: DockView | null): DockMount {
  const open = view !== null;
  const instant = instantVersion();
  // The most recent open view — what a collapse keeps on screen while it slides out.
  const lastView = useRef<DockView | null>(null);
  if (open) lastView.current = view;
  /** The current open/close episode and its frozen animate decision. */
  const episode = useRef({ open, instant, animate: true });
  /** True while a closed dock lingers for its collapse; a timer ends it. */
  const lingering = useRef(false);
  const [, bumpTick] = useState(0);

  if (open !== episode.current.open) {
    const animate = instant === episode.current.instant;
    episode.current = { open, instant, animate };
    lingering.current = !open && animate && lastView.current !== null;
  } else if (instant !== episode.current.instant) {
    // An instant bump without an open flip here (e.g. the other dock moved): track it so
    // it cannot retroactively mark a LATER flip instant.
    episode.current.instant = instant;
  }

  useEffect(() => {
    if (open || !lingering.current) return;
    const timer = window.setTimeout(() => {
      lingering.current = false;
      bumpTick((t) => t + 1); // unmount the lingering node now that the collapse ended
    }, DOCK_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (open) return { view, open: true, animateEntrance: episode.current.animate };
  if (lingering.current && lastView.current !== null)
    return { view: lastView.current, open: false, animateEntrance: true };
  return { view: closedView, open: false, animateEntrance: episode.current.animate };
}
