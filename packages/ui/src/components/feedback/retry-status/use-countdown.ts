/**
 * A live countdown: the whole seconds left until `targetMs`, re-rendered once a second while the
 * moment is still ahead, on the package's one clock (`useNow`: a single timer aligned to the
 * second boundary for every clock and countdown on the page, paused while the document is
 * hidden). Null without a target, 0 once it is reached — and from then on nothing ticks.
 *
 * The seconds are measured against the time the render happens at, not the clock's floored
 * second, so a countdown that starts mid-second never shows more than the wait it was given.
 */
import { countdownSeconds } from "./countdown";
import { useNow } from "../../content/a2ui/use-now";

export function useCountdown(targetMs: number | null | undefined): number | null {
  const ahead = targetMs !== null && targetMs !== undefined && targetMs > Date.now();
  // Subscribed only while there is something to count: the tick is what re-renders.
  useNow(ahead);
  return countdownSeconds(targetMs, Date.now());
}
