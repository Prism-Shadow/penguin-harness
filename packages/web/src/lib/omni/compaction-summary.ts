/**
 * Display text for a compaction row's expandable body: the summary the compaction request
 * wrote, with the `[summary]` tags stripped.
 *
 * Split out of the banner component so it can be unit-tested (the Web test suite runs in a
 * node environment and renders no React). Extraction uses core's own lenient extractor, so
 * what the row shows is what the engine would adopt: the first non-empty tag pair, else the
 * text left after stripping empty tags, else the raw output verbatim — a summary still
 * mid-stream (opening tag written, closing tag not yet) therefore reads as plain text
 * rather than disappearing until the model closes the block.
 */
import { extractSummary } from "@prismshadow/penguin-core/markers";
import type { CompactionItem } from "./stream-model";

/**
 * Whether the row's result section is on screen yet. It appears only once the request has
 * moved past its thinking: the first summary text lands (which is also what settles the
 * thinking section), or the compaction has completed with a summary. While the request is
 * still thinking the body shows the thinking section alone — a result row with nothing in it
 * beside a streaming thought read as two things happening at once, when only one was.
 */
export function compactionResultVisible(
  item: Pick<CompactionItem, "summaryText" | "summaryStartedAtMs" | "running" | "status">,
): boolean {
  if (compactionSummaryText(item) !== "") return true;
  if (item.summaryStartedAtMs !== undefined) return true;
  return !item.running && item.status === "completed";
}

export function compactionSummaryText(item: Pick<CompactionItem, "summaryText">): string {
  const raw = item.summaryText;
  if (!raw) return "";
  return extractSummary(raw).trim();
}
