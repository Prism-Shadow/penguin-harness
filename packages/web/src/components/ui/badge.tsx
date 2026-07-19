/**
 * Badge component: a small pill-shaped label for status/type (stop_reason, running status, Trace event type, etc.).
 */
import type { ReactNode } from "react";

export type BadgeTone = "gray" | "brand" | "green" | "amber" | "red";

const toneClass: Record<BadgeTone, string> = {
  gray: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  brand: "bg-gray-200/80 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
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
