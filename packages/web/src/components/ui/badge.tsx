/**
 * Badge component: a small pill-shaped label for status/type (stop_reason, running status, Trace event type, etc.).
 */
import type { ReactNode } from "react";
import { toneSurface } from "../../lib/tone";

/**
 * Badge tones are named for their colour rather than for a meaning: a badge labels an attribute
 * ("vision", "fast mode") at least as often as it reports a status, so a semantic name would be
 * wrong at half the call sites. The class strings themselves still come from the shared status
 * tones, so a badge that *does* report a status matches every other mark for that state.
 */
export type BadgeTone = "gray" | "brand" | "green" | "yellow" | "amber" | "red";

const toneClass: Record<BadgeTone, string> = {
  gray: toneSurface.muted,
  // Neutral emphasis, outside the status vocabulary: a heavier gray for a tag that should read
  // as prominent without claiming any severity ("default", "origin", "queued").
  brand: "bg-gray-200/80 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200",
  green: toneSurface.success,
  // Light-yellow, also outside the status vocabulary: a neutral informational tag (the "Free"
  // model badge). It stays on the yellow palette so it reads as distinct from amber, which
  // carries warning semantics (aborted stop_reason, the proxy-vision badge on the same card).
  yellow: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  amber: toneSurface.attention,
  red: toneSurface.danger,
};

export function Badge({ tone = "gray", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

/** stop_reason -> badge tone (completed usually shows no badge). */
export function stopReasonTone(stopReason: string): BadgeTone {
  switch (stopReason) {
    case "completed":
      return "green";
    case "aborted":
      return "amber";
    default:
      return "red"; // failed / timeout / malformed
  }
}
