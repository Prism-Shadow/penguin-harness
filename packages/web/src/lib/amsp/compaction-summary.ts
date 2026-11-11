/**
 * Display text for a compaction row's expandable body: the summary the compaction request
 * wrote, with the `[summary]` tags stripped.
 *
 * Split out of the banner component so it can be unit-tested (the Web test suite runs in a
 * node environment and renders no React). Extraction uses the engine's own readers, so what
 * the row shows is what the next context opened with: a summary through the lenient extractor
 * (the first non-empty tag pair, else the text left after stripping empty tags, else the raw
 * output verbatim — a summary still mid-stream, opening tag written and closing tag not yet,
 * therefore reads as plain text rather than disappearing until the model closes the block),
 * and a salvaged one as the text inside its tag, which is the part the engine keeps.
 */
import { extractSummary, summaryInTags } from "@prismshadow/amsp/markers";
import type { CompactionItem } from "./stream-model";

/**
 * Whether the row's result section is on screen yet. It appears only once the request has
 * moved past its thinking: the first summary text lands (which is also what settles the
 * thinking section), or the compaction has completed with a summary. While the request is
 * still thinking the body shows the thinking section alone — a result row with nothing in it
 * beside a streaming thought read as two things happening at once, when only one was. A
 * compaction that completed with the hand-off note has no result at all.
 */
export function compactionResultVisible(
  item: Pick<
    CompactionItem,
    "summaryText" | "summaryStartedAtMs" | "running" | "status" | "outcome"
  >,
): boolean {
  if (compactionSummaryText(item) !== "") return true;
  if (item.summaryStartedAtMs !== undefined) return true;
  return !item.running && item.status === "completed" && item.outcome !== "handoff";
}

export function compactionSummaryText(
  item: Pick<CompactionItem, "summaryText" | "outcome">,
): string {
  const raw = item.summaryText;
  if (!raw) return "";
  if (item.outcome === "salvaged") return summaryInTags(raw)?.text ?? extractSummary(raw).trim();
  return extractSummary(raw).trim();
}
