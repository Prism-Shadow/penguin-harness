/**
 * Live duration (inline display on running thinking/tool cards): ticks every second. sinceMs
 * comes from the server-side message timestamp and may drift from the local clock; negative
 * values are shown as 0; a pulsing ellipsis is shown when missing.
 * `offsetMs` is the already-settled duration of a prior segment (e.g. a tool call's argument
 * generation phase), added on top of the live segment as it ticks.
 */
import { useEffect, useState } from "react";
import { humanizeDuration } from "../../lib/format";

export function LiveDuration({ sinceMs, offsetMs = 0 }: { sinceMs?: number; offsetMs?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (sinceMs === undefined) return <span className="animate-pulse">…</span>;
  return <>{humanizeDuration(Math.max(0, offsetMs) + Math.max(0, now - sinceMs))}</>;
}
