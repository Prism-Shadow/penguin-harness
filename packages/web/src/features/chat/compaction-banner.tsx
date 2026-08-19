/**
 * Compaction row: one StepBanner across running/done/failed (same shell as the MCP
 * connect row and the reasoning-&-tools group header) — mode while running, outcome plus
 * wall time once settled, failures on a single line.
 *
 * The streamed summary (issue #290): while the compaction request writes its summary, the
 * text arrives as `compaction_delta` events accumulated onto `item.summaryText` — the
 * running banner shows the tail of it live under the header (the same text a history
 * rebuild reconstructs from the compaction span, so a reload agrees with the live view);
 * once settled, the full text folds into the banner's expandable body. Summary tags are
 * stripped for display via the same lenient extractor core uses to adopt the summary.
 *
 * Doesn't show Tokens: the row only needs to state whether compaction happened and whether it
 * succeeded. Compaction's cost lands in different places depending on when it occurs — compaction
 * that happens **mid-turn** counts toward that turn's stats line and cost; compaction **after a
 * turn ends** and manual compaction both go into the Session total (the Trace page lists
 * compaction turns separately); see the task-stats module comments.
 */
import { extractSummary } from "@prismshadow/penguin-core/markers";
import { S } from "../../lib/strings";
import type { CompactionItem } from "../../lib/omni/stream-model";
import { StepBanner } from "./step-banner";

/** Tail cap for the live preview (characters after tag stripping): enough to read along without the row swallowing the stream. */
const LIVE_TAIL_CHARS = 600;

/** Strips the summary tags for display; empty when nothing readable has streamed yet. */
function displaySummary(raw: string | undefined): string {
  if (!raw) return "";
  return extractSummary(raw).trim();
}

function SummaryBody({ text, tail }: { text: string; tail: boolean }) {
  const shown =
    tail && text.length > LIVE_TAIL_CHARS ? `…${text.slice(text.length - LIVE_TAIL_CHARS)}` : text;
  return (
    <div className="max-h-48 overflow-y-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap text-gray-500 dark:text-gray-400">
      {shown}
    </div>
  );
}

export function CompactionBanner({ item }: { item: CompactionItem }) {
  const summary = displaySummary(item.summaryText);
  if (item.running) {
    return (
      <StepBanner
        state="running"
        title={S.chat.compactionTitle}
        detail={item.mode}
        {...(item.beginTsMs !== undefined ? { liveSinceMs: item.beginTsMs } : {})}
        {...(summary !== "" ? { liveBody: <SummaryBody text={summary} tail /> } : {})}
      />
    );
  }
  const ok = item.status === "completed";
  return (
    <StepBanner
      state={ok ? "done" : "failed"}
      title={S.chat.compactionTitle}
      detail={
        ok
          ? S.chat.compactionDone(item.mode)
          : S.chat.compactionFailed(item.status ?? "failed", item.errorMessage)
      }
      {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
    >
      {summary !== "" ? <SummaryBody text={summary} tail={false} /> : null}
    </StepBanner>
  );
}
