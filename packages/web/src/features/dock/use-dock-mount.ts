/**
 * Mount state of one dock position, giving open/close its animation without giving one to
 * changes that must be instant.
 *
 * The store's dockViews() only lists OPEN docks, but a collapse transition needs the node
 * on both ends of it — so this hook keeps the last view mounted (open=false, sliding to
 * zero) for the transition's duration before unmounting for real. Changes the store marks
 * instant (scope switches, cross-dock moves — see instantVersion) skip both directions:
 * a closing dock unmounts immediately, an opening one mounts at full size.
 *
 * The animate/linger decision is frozen AT RENDER TIME of the open/close flip (a ref
 * adjusted during render — deterministic for a given store state, so a re-render replays
 * it identically): an effect would decide only after the flip already painted, which for
 * a close means the node is gone before the transition could start.
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
  /** The view to render, kept through the exit transition; null = nothing mounted. */
  view: DockView | null;
  /** False only while the mounted view is collapsing on its way out. */
  open: boolean;
  /** Whether an opening dock plays the expand transition (false for instant changes). */
  animateEntrance: boolean;
}

export function useDockMount(view: DockView | null): DockMount {
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
  return { view: null, open: false, animateEntrance: true };
}
