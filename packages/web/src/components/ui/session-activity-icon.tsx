import type { SessionActivity } from "../../lib/session-activity";

/**
 * Session-level activity glyphs are intentionally different from step-level StatusIcon:
 * neutral motion says "work is still happening", while color is reserved for an outcome that
 * needs attention in the conversation list.
 */
export function SessionActivityIcon({
  activity,
  label,
  size = 8,
}: {
  activity: Exclude<SessionActivity, null>;
  label: string;
  size?: number;
}) {
  if (activity === "running") {
    return (
      <span
        role="status"
        title={label}
        aria-label={label}
        style={{ width: size, height: size }}
        className="inline-block shrink-0 animate-spin rounded-full border-[1.5px] border-gray-400 border-t-transparent dark:border-gray-500 dark:border-t-transparent"
      />
    );
  }
  return (
    <span
      role="status"
      title={label}
      aria-label={label}
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-full ${
        activity === "compacting" ? "bg-amber-500" : "bg-emerald-500"
      }`}
    />
  );
}
