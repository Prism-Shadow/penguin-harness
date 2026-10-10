/**
 * A running item's elapsed time, and the duration it settles into.
 *
 * `LiveDuration` is the clock on a running card: it ticks every second and shows whole seconds
 * only — the tenth appears on the settled value once the item finishes. `sinceMs` comes from a
 * server-side timestamp and may drift from the local clock, so a negative span reads as zero; a
 * missing start shows an ellipsis. `offsetMs` is the settled duration of an earlier segment (a
 * tool call's argument generation), added under the live one as it ticks.
 *
 * `DurationSlot` is the slot a row keeps for that number: the live clock while the item runs, the
 * settled duration once it has one, nothing before either is known.
 *
 * `useElapsedPast` answers a single threshold question instead, and re-renders once, at the
 * crossing — a caller that only shows or hides something has nothing to do with a tick.
 */
import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { formatDuration, formatDurationLive } from "./format-duration";

export { formatDuration, formatDurationLive } from "./format-duration";

/**
 * Whether `sinceMs` has been running for `thresholdMs`: false until that moment, then true. One
 * re-render at the crossing rather than a ticking clock. An undefined `sinceMs` (nothing running,
 * or no start known) reads as false for as long as it stays undefined.
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
  if (sinceMs === undefined) return <>…</>;
  return <>{formatDurationLive(Math.max(0, offsetMs) + Math.max(0, now - sinceMs))}</>;
}

/**
 * The duration slot of a row: mono small figures in the subtle ink, holding the live clock while
 * `running` (an ellipsis until its start is known), the settled `durationMs` otherwise, and
 * nothing for a settled item with no duration.
 * Other attributes (a `data-slot="detail"` for the activity hook) pass through.
 */
export function DurationSlot({
  running,
  sinceMs,
  durationMs,
  offsetMs,
  className = "",
  ...rest
}: {
  running: boolean;
  /** When the running item started (a server timestamp). */
  sinceMs?: number;
  /** The settled duration, once known. */
  durationMs?: number;
  /** A settled earlier segment the live clock counts on top of. */
  offsetMs?: number;
  /** Layout only (a responsive `hidden`, a margin). */
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children">) {
  if (!running && durationMs === undefined) return null;
  return (
    <span
      {...rest}
      className={`shrink-0 font-mono text-xs tabular-nums text-fg-subtle ${className}`}
    >
      {running ? (
        <LiveDuration
          {...(sinceMs !== undefined ? { sinceMs } : {})}
          {...(offsetMs !== undefined ? { offsetMs } : {})}
        />
      ) : (
        formatDuration(durationMs ?? 0)
      )}
    </span>
  );
}
