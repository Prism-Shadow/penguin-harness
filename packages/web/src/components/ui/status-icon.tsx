/**
 * Run state icon (shared by the chat page's "reasoning & tools" group and tool
 * cards): a spinning ring while running, a static glyph otherwise — "still
 * running" vs. "done" can be told apart at a glance, no need to read the text.
 */
export type RunState = "running" | "waiting" | "done" | "failed";

const GLYPH: Record<Exclude<RunState, "running">, string> = {
  // Hourglass (waiting for approval)
  waiting: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",
  // Checkmark (completed)
  done: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-3.5-9.2 2.4 2.5 4.6-4.8",
  // X (failed / interrupted)
  failed: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6m0-6-6 6",
};

const TONE: Record<RunState, string> = {
  running: "text-emerald-500 dark:text-emerald-400",
  waiting: "text-amber-500 dark:text-amber-400",
  done: "text-gray-400 dark:text-gray-500",
  failed: "text-red-500 dark:text-red-400",
};

export function StatusIcon({
  state,
  size = 13,
  label,
}: {
  state: RunState;
  size?: number;
  /** The icon carries no text of its own; this supplies a status description (visible on hover). */
  label?: string;
}) {
  if (state === "running") {
    return (
      <span
        {...(label
          ? { title: label, "aria-label": label, role: "status" }
          : { "aria-hidden": true })}
        style={{ width: size, height: size }}
        className={`inline-block shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${TONE.running}`}
      />
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Without a label, this icon is decorative (the status is already conveyed by
      // adjacent text): it must not have role="img" without an accessible name, or
      // a screen reader would announce it as an anonymous image.
      {...(label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true })}
      className={`block shrink-0 ${TONE[state]}`}
    >
      {label && <title>{label}</title>}
      <path d={GLYPH[state]} />
    </svg>
  );
}
