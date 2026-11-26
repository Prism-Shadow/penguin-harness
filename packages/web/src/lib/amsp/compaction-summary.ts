/**
 * Display text for a compaction row's expandable body: the summary the compaction request
 * wrote, with the `[summary]` tags stripped, or the Trace hand-over a model switch opened the
 * next context with in its place; and what the row reads off its end.
 *
 * Split out of the banner component so it can be unit-tested (the Web test suite runs in a
 * node environment and renders no React). Extraction uses core's own lenient extractor, so
 * what the row shows is what the engine would adopt: the first non-empty tag pair, else the
 * text left after stripping empty tags, else the raw output verbatim — a summary still
 * mid-stream (opening tag written, closing tag not yet) therefore reads as plain text
 * rather than disappearing until the model closes the block.
 */
import {
  dualFormPatterns,
  extractSummary,
  MARKER_TAGS,
  matchDualForm,
} from "@prismshadow/amsp/markers";
import type { ChatItem, CompactionHandover, CompactionItem } from "./stream-model";

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
    | "summaryText"
    | "summaryStartedAtMs"
    | "running"
    | "status"
    | "errorCode"
    | "errorMessage"
    | "handover"
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
 * A compaction that completed without a full summary: a `completed` end carrying the error pair,
 * or a model switch's Trace hand-over standing in the summary's place — the row of a switch whose
 * current model could not be reached is that hand-over alone, with no end to carry a pair.
 */
export function compactionDegraded(
  item: Pick<CompactionItem, "status" | "errorCode" | "errorMessage" | "handover">,
): boolean {
  return (
    item.status === "completed" &&
    (item.errorCode !== undefined || item.errorMessage !== undefined || item.handover !== undefined)
  );
}

/**
 * For a row that completed without a full summary (compactionDegraded): whether the model it
 * left was asked for one. Such a row with no error pair is a switch's hand-over that sent that
 * model no compaction request.
 */
export function compactionSummaryAsked(
  item: Pick<CompactionItem, "errorCode" | "errorMessage">,
): boolean {
  return item.errorCode !== undefined || item.errorMessage !== undefined;
}

const HANDOVER_BLOCK = dualFormPatterns(MARKER_TAGS.modelSwitchFrom, "\\n([\\s\\S]*)\\n");

/**
 * The note a model switch's Trace hand-over opened the next context with, as its section shows
 * it: the `[model_switch_from]` block's own lines, its tags stripped as the result section strips
 * the summary's. The reducer only folds a text that is one whole block; anything else reads as
 * written.
 */
export function compactionHandoverNote(handover: Pick<CompactionHandover, "text">): string {
  const text = handover.text.trim();
  const block = matchDualForm(HANDOVER_BLOCK, text);
  const whole = block !== null && block.index === 0 && block[0].length === text.length;
  return whole ? block[1]!.trim() : text;
}

/**
 * A degraded completion for want of room under the model's window (`rejected`,
 * `output_truncated`): fixed by correcting the window or lowering the threshold, which the row's
 * mark then advises.
 */
export function compactionShortOfRoom(
  item: Pick<CompactionItem, "status" | "errorCode" | "errorMessage" | "handover">,
): boolean {
  return (
    compactionDegraded(item) &&
    (item.errorCode === "rejected" || item.errorCode === "output_truncated")
  );
}

/** The Session's latest compaction when a refusal forced it. */
export interface RefusalHandoff {
  /** Its begin time, which the live stream and the Trace agree on: what a dismissal is keyed by. */
  occurrence: string;
  /** The compaction row the refusal forced; its error pair is the refused request's. */
  item: CompactionItem;
}

/**
 * The Session's latest compaction row when a refusal forced it (a degraded end with `rejected`).
 * Null otherwise — so any later compaction, ended any other way, takes it down.
 */
export function refusalHandoff(items: readonly ChatItem[]): RefusalHandoff | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== "compaction") continue;
    if (!compactionDegraded(item) || item.errorCode !== "rejected") return null;
    return {
      occurrence: item.beginTsMs !== undefined ? String(item.beginTsMs) : `#${item.id}`,
      item,
    };
  }
  return null;
}
