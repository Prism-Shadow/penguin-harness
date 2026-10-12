/**
 * The phases of a fold's body (`Fold`, fold.tsx), as a pure step function so the machine is
 * testable without a DOM or a clock.
 *
 * - `closed`: nothing is rendered.
 * - `settled`: open, nothing moving — a body that mounted open (a page that loads with hundreds
 *   of open groups moves none of them) or one whose entrance has finished.
 * - `open`: opened after mount, the entrance under way: the theme's `@starting-style` rule
 *   starts the track at `0fr` and the layout motion eases it to `1fr`.
 * - `closing`: easing to `0fr`, still mounted (and inert) until the track's transition ends;
 *   with no transition to wait for it closes at once.
 *
 * Re-opening mid-close flips back to `open`, from wherever the track has got to.
 */
export type FoldPhase = "closed" | "open" | "settled" | "closing";

export type FoldEvent =
  /**
   * The caller's `open` changed. `duration` is the track's computed `transition-duration` at
   * that moment, read only for a close: a zero (reduced motion, a sheet without the motion
   * tokens) or a missing one means no transition will run, so nothing would ever end it.
   */
  | { open: boolean; duration?: string }
  /** The track's transition ended, or was cancelled. */
  | { ended: true };

/** Where a fold starts: open at mount is settled, never an entrance. */
export function foldStart(open: boolean): FoldPhase {
  return open ? "settled" : "closed";
}

/** Whether a computed `transition-duration` (a comma-separated list) runs no transition at all. */
export function instantDuration(duration: string | undefined): boolean {
  if (duration === undefined) return true;
  return duration.split(",").every((part) => !(Number.parseFloat(part) > 0));
}

export function foldStep(phase: FoldPhase, event: FoldEvent): FoldPhase {
  if ("ended" in event) {
    if (phase === "closing") return "closed";
    if (phase === "open") return "settled";
    return phase;
  }
  if (event.open) return phase === "closed" || phase === "closing" ? "open" : phase;
  if (phase === "closed" || phase === "closing") return phase;
  return instantDuration(event.duration) ? "closed" : "closing";
}
