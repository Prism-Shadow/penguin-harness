/**
 * A live countdown: the whole seconds left until `targetMs`, re-rendered once a second while the
 * moment is still ahead, on the package's one clock (`useNow`: a single timer aligned to the
 * second boundary for every clock and countdown on the page, paused while the document is
 * hidden). Null without a target, 0 once it is reached — and from then on nothing ticks.
 *
 * The seconds are measured against the time the render happens at, not the clock's floored
 * second, so a countdown that starts mid-second never shows more than the wait it was given.
 */
import { useState } from "react";
import { countdownSeconds } from "./countdown";
import { useNow } from "../../content/a2ui/use-now";

export function useCountdown(targetMs: number | null | undefined): number | null {
  const ahead = targetMs !== null && targetMs !== undefined && targetMs > Date.now();
  // Subscribed only while there is something to count: the tick is what re-renders.
  useNow(ahead);
  return countdownSeconds(targetMs, Date.now());
}

/**
 * How many digits the seconds of one wait need at their widest: the count they started from, kept
 * for as long as the wait (`targetMs`) is the same one, so 10 s ticking down to 9 s keeps two
 * digits' room. A new wait starts over. Zero without seconds.
 */
export function useWidestDigits(targetMs: number | null, seconds: number | null): number {
  const digits = seconds === null ? 0 : String(seconds).length;
  const [widest, setWidest] = useState({ targetMs, digits });
  const sameWait = widest.targetMs === targetMs;
  const reserve = sameWait ? Math.max(widest.digits, digits) : digits;
  // Adjusted while rendering, so the first frame of a new wait already reserves its own width.
  if (!sameWait || reserve !== widest.digits) setWidest({ targetMs, digits: reserve });
  return reserve;
}
