/**
 * Live duration (inline display on running thinking/tool cards): ticks every second, showing
 * whole seconds only — decimals appear only on the settled value once the item finishes. sinceMs
 * comes from the server-side message timestamp and may drift from the local clock; negative
 * values are shown as 0; a pulsing ellipsis is shown when missing.
 * `offsetMs` is the already-settled duration of a prior segment (e.g. a tool call's argument
 * generation phase), added on top of the live segment as it ticks.
 */
import { useEffect, useState } from "react";
import { humanizeDurationLive } from "../../lib/format";

/**
 * How long `sinceMs` has been running, reported only once it has run for `thresholdMs`: 0 until
 * that moment, then the elapsed time at the render that crossed it. One re-render at the
 * crossing rather than a ticking clock — the caller compares the value to the threshold, so a
 * finer reading would only cost renders. Undefined `sinceMs` (nothing running, or no start
 * time known) reads as 0 for as long as it stays undefined.
 */
export function useElapsedPast(sinceMs: number | undefined, thresholdMs: number): number {
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
  return reached && sinceMs !== undefined ? Math.max(0, Date.now() - sinceMs) : 0;
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
