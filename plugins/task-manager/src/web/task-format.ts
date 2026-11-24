/**
 * The Task Manager page's formatting: the figures it shows, turned into words. Kept apart from the
 * component so the suite pins them, and so every number on the page is spelled one way.
 */

/**
 * A Token count as a short figure: a thousand and up keeps one decimal, a million and up likewise,
 * and the rest is the count itself. Tokens are counted, not measured, so `1.2M` never reads as an
 * estimate.
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0";
  if (tokens >= 1_000_000) return `${trimZero((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 1_000) return `${trimZero((tokens / 1_000).toFixed(1))}k`;
  return String(Math.round(tokens));
}

/** `1.0` → `1`, `1.2` → `1.2`: a whole figure loses its decimal rather than reading as a measurement. */
function trimZero(text: string): string {
  return text.replace(/\.0$/, "");
}

/** A CPU share as words: one decimal, and the caller's word for a figure nobody could take. */
export function formatCpu(cpu: number | null, fallback: string): string {
  return cpu === null ? fallback : `${cpu.toFixed(1)}%`;
}

/** A memory figure through the face's own byte formatter; the fallback when there is none. */
export function formatMemory(
  memory: number | null,
  formatBytes: (bytes: number) => string,
  fallback: string,
): string {
  return memory === null ? fallback : formatBytes(memory);
}

/**
 * A price as the account states it, in the currency the prices are stored in: two decimals from a
 * cent up, four below it, so a real charge never reads as zero; the fallback when there is no
 * price to show.
 */
export function formatCost(cost: number | null, fallback: string): string {
  if (cost === null || !Number.isFinite(cost)) return fallback;
  const abs = Math.abs(cost);
  const text = abs !== 0 && abs < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
  return `$${text}`;
}

/** Whether a user-channel event can move the task tree (a machine's arrives wrapped). */
export function touchesTaskTree(ev: {
  readonly type: string;
  readonly event?: { readonly type: string };
}): boolean {
  const type = ev.type === "machine_event" && ev.event !== undefined ? ev.event.type : ev.type;
  return (
    type === "session_created" ||
    type === "session_state" ||
    type === "session_title" ||
    type === "session_background" ||
    type === "session_approvals" ||
    type === "session_archived" ||
    type === "session_deleted" ||
    type === "workbench_updated" ||
    type === "workbench_removed" ||
    type === "org_run" ||
    type === "schedule_fired" ||
    type === "resync_required"
  );
}
