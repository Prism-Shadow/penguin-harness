/**
 * What a compaction row shows: the summary the compaction request wrote, with the `[summary]`
 * tags stripped, and the facts its end records — whether it completed without a full summary,
 * and whether that was for want of room under the model's window.
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
 * beside a streaming thought read as two things happening at once, when only one was. A
 * compaction that completed without a full summary has no result at all.
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

/**
 * A compaction that completed without a full summary: a `completed` end carrying the error pair.
 * The next context opened with what was written of the summary, or with the harness's Trace
 * hand-off note; the Trace says which, and the row does not.
 */
export function compactionDegraded(
  item: Pick<CompactionItem, "status" | "errorCode" | "errorMessage">,
): boolean {
  return (
    item.status === "completed" && (item.errorCode !== undefined || item.errorMessage !== undefined)
  );
}

/**
 * A degraded completion for want of room under the model's window: the provider refused a
 * request as sent (`rejected`), or the summary was cut off at the output limit every time it
 * was asked for (`output_truncated`). Both are fixed by correcting the model's context window
 * or lowering the compaction threshold, which is what the row's mark then advises.
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
 * The Session's latest compaction row when it is a completed one the provider's refusal of a
 * request forced (`error_code` `rejected`): an id for that occurrence (its begin time, which
 * the live stream and the Trace agree on), or null — no compaction yet, or a later one ended
 * any other way. The composer raises its notice on this, so a later normal compaction takes
 * the notice down by becoming the latest row.
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
