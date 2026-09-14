/**
 * Two readings of a running item's elapsed time, and only one of them is a clock.
 * `LiveDuration` is the inline display on running thinking/tool cards: it ticks every second,
 * showing whole seconds only — decimals appear only on the settled value once the item
 * finishes. sinceMs comes from the server-side message timestamp and may drift from the local
 * clock; negative values are shown as 0; a pulsing ellipsis is shown when missing. `offsetMs`
 * is the already-settled duration of a prior segment (e.g. a tool call's argument generation
 * phase), added on top of the live segment as it ticks.
 * `useElapsedPast` answers a single threshold question instead, and re-renders once, at the
 * crossing — a caller that only shows or hides something has nothing to do with a tick.
 */
import { useEffect, useState } from "react";
import { humanizeDurationLive } from "../../lib/format";

/**
 * Whether `sinceMs` has been running for `thresholdMs`: false until that moment, then true.
 * One re-render at the crossing rather than a ticking clock — the answer changes once, so
 * anything finer would only cost renders. Undefined `sinceMs` (nothing running, or no start
 * time known) reads as false for as long as it stays undefined.
 */
export function useElapsedPast(sinceMs: number | undefined, thresholdMs: number): boolean {
  const [reached, setReached] = useState(
    () => sinceMs !== undefined && Date.now() - sinceMs >= thresholdMs,
  );
  useEffect(() => {
    if (sinceMs === undefined) {
      setReached(false);
      return;
    }
    const remaining = thresholdMs - (Date.now() - sinceMs);
    if (remaining <= 0) {
      setReached(true);
      return;
    }
    setReached(false);
    const id = setTimeout(() => setReached(true), remaining);
    return () => clearTimeout(id);
  }, [sinceMs, thresholdMs]);
  // The `sinceMs` term is load-bearing: on the render where it goes undefined the effect that
  // clears `reached` has not run yet, so the state still holds the previous subject's answer.
  return reached && sinceMs !== undefined;
}

export function LiveDuration({ sinceMs, offsetMs = 0 }: { sinceMs?: number; offsetMs?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (sinceMs === undefined) return <span className="animate-pulse">…</span>;
  return <>{humanizeDurationLive(Math.max(0, offsetMs) + Math.max(0, now - sinceMs))}</>;
}
