/**
 * Display text for a compaction row's expandable body: the summary the compaction request
 * wrote, with the `[summary]` tags stripped; and what the row reads off its end.
 *
 * Split out of the banner component so it can be unit-tested (the Web test suite runs in a
 * node environment and renders no React). Extraction uses core's own lenient extractor, so
 * what the row shows is what the engine would adopt: the first non-empty tag pair, else the
 * text left after stripping empty tags, else the raw output verbatim — a summary still
 * mid-stream (opening tag written, closing tag not yet) therefore reads as plain text
 * rather than disappearing until the model closes the block.
 */
import { extractSummary } from "@prismshadow/amsp/markers";
import type { ChatItem, CompactionItem } from "./stream-model";

/**
 * Whether the row's result section is on screen yet. It appears only once the request has
 * moved past its thinking: the first summary text lands (which is also what settles the
 * thinking section), or the compaction has completed with a summary. While the request is
 * still thinking the body shows the thinking section alone — a result row with nothing in it
 * beside a streaming thought read as two things happening at once, when only one was.
 */
export function compactionResultVisible(
  item: Pick<
    CompactionItem,
    "summaryText" | "summaryStartedAtMs" | "running" | "status" | "errorCode" | "errorMessage"
  >,
): boolean {
  if (compactionSummaryText(item) !== "") return true;
  if (item.summaryStartedAtMs !== undefined) return true;
  return !item.running && item.status === "completed" && !compactionDegraded(item);
}

export function compactionSummaryText(item: Pick<CompactionItem, "summaryText">): string {
  const raw = item.summaryText;
  if (!raw) return "";
  return extractSummary(raw).trim();
}

/** A compaction that completed without a full summary: a `completed` end carrying the error pair. */
export function compactionDegraded(
  item: Pick<CompactionItem, "status" | "errorCode" | "errorMessage">,
): boolean {
  return (
    item.status === "completed" && (item.errorCode !== undefined || item.errorMessage !== undefined)
  );
}

/**
 * A degraded completion for want of room under the model's window (`rejected`,
 * `output_truncated`): fixed by correcting the window or lowering the threshold, which the row's
 * mark then advises.
 */
export function compactionShortOfRoom(
  item: Pick<CompactionItem, "status" | "errorCode" | "errorMessage">,
): boolean {
  return (
    compactionDegraded(item) &&
    (item.errorCode === "rejected" || item.errorCode === "output_truncated")
  );
}

/**
 * An id for the Session's latest compaction row when a refusal forced it (a degraded end with
 * `rejected`): its begin time, which the live stream and the Trace agree on. Null otherwise —
 * so any later compaction, ended any other way, takes the occurrence down.
 */
export function refusalHandoffOccurrence(items: readonly ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== "compaction") continue;
    if (!compactionDegraded(item) || item.errorCode !== "rejected") return null;
    return item.beginTsMs !== undefined ? String(item.beginTsMs) : `#${item.id}`;
  }
  return null;
}
