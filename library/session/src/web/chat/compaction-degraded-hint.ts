/**
 * Why a compaction completed without a full summary, in the words its row says it twice: the
 * degraded status mark's tooltip and accessible name, and the opening lines of a model switch's
 * hand-over section, which must not tell the reason differently from the mark above it.
 */
import {
  S,
  compactionShortOfRoom,
  compactionSummaryAsked,
} from "@prismshadow/penguin-web/internal";
import type { CompactionItem } from "@prismshadow/penguin-web/internal";
import { httpStatusOf } from "./provider-error";

/**
 * The reason, one line per part. The cause comes from the dictionary the retry line uses, so the
 * row and the line above it name a refusal the same way; a switch that asked the model it left
 * for nothing says that instead.
 */
export function compactionDegradedText(item: CompactionItem): string {
  const t = S.chat.requestRetry;
  let why: string | null = S.chat.compactionHandoverUnasked;
  if (compactionSummaryAsked(item)) {
    const cause = t.cause(item.errorCode);
    why = cause === null ? null : t.why(cause, httpStatusOf(item.errorMessage));
  }
  return S.chat.compactionDegradedHint(why, item.errorMessage, compactionShortOfRoom(item));
}
