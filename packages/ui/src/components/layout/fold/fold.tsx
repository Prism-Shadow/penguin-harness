/**
 * The one disclosure body that mounts on open and folds both ways: a work group's rows, the
 * sidebar's folding nav entries, a session group's rows, a lazy folder's.
 *
 * The body is a one-row grid whose track goes between `0fr` and `1fr`, never `auto`, and it
 * carries `data-layout-motion`, so the theme's layout tokens time it (Frost a long ease-out,
 * Primer a short in-out, Console four steps) and reduced motion stills it. The component writes
 * no duration, easing or keyframe: it names its phase in `data-fold`, and the theme foundation
 * (`theme.css`) turns the phase into a track — `1fr` open, `0fr` closing, and an `@starting-style`
 * of `0fr` for a body opened after mount, so it enters without a two-render dance (a browser
 * without `@starting-style` simply opens it at once).
 *
 * Closed and finished, nothing is rendered. A body that mounts open is `settled` and does not
 * tween, so a page load moves nothing. Closing keeps the body mounted and `inert` until the
 * track's own transition ends — or at once when its computed duration is zero, or when it is not
 * rendered at all (a hidden ancestor runs no transition, so no event would ever come). The inner
 * box clips only while the track moves: at rest its content may paint past it (a focus ring, a
 * row's shadow), and `overflow: clip` rather than `hidden`, since a hidden box would become the
 * scroll container its sticky rows stick to. Content that grows inside an open fold is not a
 * transition — only the track value tweens — so rows arriving in a running group never animate
 * height.
 *
 * `children` may be a function, called only while the body renders, for a body that costs
 * something to build when it is folded away (a session group's rows).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, TransitionEvent } from "react";
import { foldStart, foldStep, instantDuration } from "./fold-phase";
import type { FoldPhase } from "./fold-phase";

export interface FoldProps {
  /** The body shows. */
  open: boolean;
  /** Called once a close has finished and the body has left (after the tween, or at once). */
  onClosed?: () => void;
  /** Classes on the folding track, the outer box. */
  className?: string;
  /**
   * Classes on the box that holds the children: a list's own layout goes here (a tree, its
   * dividers), since its rows are this box's children.
   */
  bodyClassName?: string;
  /** The track's slot in its host's anatomy (`body` under an activity card's head). */
  "data-slot"?: string;
  children?: ReactNode | (() => ReactNode);
}

/** The track's transition: the one the phase machine waits on. */
const TRACK = "grid-template-rows";

export function Fold({
  open,
  onClosed,
  className = "",
  bodyClassName = "",
  "data-slot": slot,
  children,
}: FoldProps) {
  const [phase, setPhase] = useState<FoldPhase>(() => foldStart(open));
  const trackRef = useRef<HTMLDivElement>(null);
  const shownOpen = useRef(open);
  const lastPhase = useRef(phase);

  // A change of `open` steps the machine before paint: a close reads the track's duration, so a
  // fold with nothing to wait for leaves in the same frame.
  useLayoutEffect(() => {
    if (shownOpen.current === open) return;
    shownOpen.current = open;
    const track = trackRef.current;
    const duration =
      open || track === null || track.getClientRects().length === 0
        ? undefined
        : getComputedStyle(track).transitionDuration;
    setPhase((current) => foldStep(current, { open, duration }));
  }, [open]);

  // An entrance with nothing to run (reduced motion, no tokens, not rendered) is over at once.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (phase !== "open" || track === null) return;
    if (
      track.getClientRects().length === 0 ||
      instantDuration(getComputedStyle(track).transitionDuration)
    ) {
      setPhase((current) => foldStep(current, { ended: true }));
    }
  }, [phase]);

  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = phase;
    if (phase === "closed" && was !== "closed") onClosed?.();
  }, [phase, onClosed]);

  if (phase === "closed") return null;

  const ended = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== TRACK) return;
    setPhase((current) => foldStep(current, { ended: true }));
  };
  const trackClass = ["grid", className].filter((part) => part !== "").join(" ");
  const bodyClass = ["min-h-0", phase === "settled" ? "" : "overflow-clip", bodyClassName]
    .filter((part) => part !== "")
    .join(" ");
  return (
    <div
      ref={trackRef}
      data-layout-motion
      data-fold={phase}
      {...(slot !== undefined ? { "data-slot": slot } : {})}
      className={trackClass}
      onTransitionEnd={ended}
      onTransitionCancel={ended}
    >
      <div className={bodyClass} inert={phase === "closing"}>
        {typeof children === "function" ? children() : children}
      </div>
    </div>
  );
}
