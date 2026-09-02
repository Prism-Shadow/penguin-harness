/**
 * Compaction row: one StepBanner across running/done/failed (same shell as the MCP
 * connect row and the reasoning-&-tools group header) — the wall time ticks while it runs
 * and settles once finished, failures stay on a single line.
 *
 * **The title names the mode**, so the two modes read as the two different things they are:
 * a `summarize` row is 压缩 / "Compaction", a `discard` row is 清空 / "Clear" — it drops the
 * old context rather than compacting it, and calling that "compaction" was the confusing part
 * (per maintainer request). With the mode in the title neither outcome needs a detail line:
 * a succeeded row is icon + title + wall time (+ chevron on a summarize), and the detail slot
 * is left for what the title cannot say — why a compaction failed, and, while a summarize
 * runs, the hint that its body is being streamed into.
 *
 * The body follows the work group: **two stacked disclosure rows, each collapsed by default
 * exactly like a thinking block** — 「思考」/ "Thinking", what the compaction request thought
 * ahead of its summary (present only once any arrived; a model that does not think leaves
 * no empty row), and 「压缩结果」/ "Result", the summary itself. Both carry the thinking
 * block's own body (`md-body` + the streaming `Md`) and stream while the request writes
 * them; the header's chevron is there from the moment a summarize compaction starts, so the
 * reader can expand it to watch the request work, or read the outcome afterwards. A
 * `discard` compaction produces no text at all and stays chevron-less, as does a failed one:
 * a compaction that did not complete wrote no adopted summary, and the reducer discards its
 * half-written drafts (see stream-model's compaction_end handling), so there is nothing left
 * to show.
 *
 * Doesn't show Tokens: the row only needs to state whether compaction happened and whether it
 * succeeded. Compaction's cost lands in different places depending on when it occurs — compaction
 * that happens **mid-turn** counts toward that turn's stats line and cost; compaction **after a
 * turn ends** and manual compaction both go into the Session total (the Trace page lists
 * compaction turns separately); see the task-stats module comments.
 */
import { S } from "../../lib/strings";
import type { CompactionItem } from "../../lib/omni/stream-model";
import { compactionSummaryText } from "../../lib/omni/compaction-summary";
import { StatusIcon } from "../../components/ui/status-icon";
import { DisclosureRow } from "./disclosure-row";
import { Md } from "./md";
import { StepBanner } from "./step-banner";

/**
 * One body section: the thinking block's row (status icon + label + chevron) over the
 * thinking block's text body. Sticky like a row inside the work group, so a long expanded
 * section keeps its own label pinned under the stuck banner header.
 */
function CompactionSection({
  label,
  text,
  streaming,
}: {
  label: string;
  text: string;
  streaming: boolean;
}) {
  return (
    <DisclosureRow
      sticky
      icon={
        <StatusIcon
          state={streaming ? "running" : "done"}
          label={streaming ? S.chat.workRunning : S.chat.workDone}
        />
      }
      label={label}
    >
      <div className="md-body anim-fade mx-3 mb-2 rounded-md bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-600 dark:bg-gray-900/60 dark:text-gray-400">
        <Md text={text} streaming={streaming} />
      </div>
    </DisclosureRow>
  );
}

export function CompactionBanner({ item }: { item: CompactionItem }) {
  const summary = compactionSummaryText(item);
  const thinking = item.thinkingText?.trim() ? item.thinkingText : "";
  // The chevron is stable for the whole life of a summarize compaction: present from the
  // start (before the first token arrives the result body is simply empty, as a thinking
  // block's is) rather than appearing mid-stream and shifting the row.
  const expandable =
    summary !== "" || thinking !== "" || (item.running && item.mode === "summarize");
  const body = expandable ? (
    <>
      {thinking !== "" && (
        <CompactionSection
          label={S.chat.thinking}
          text={thinking}
          streaming={item.thinkingStreaming === true}
        />
      )}
      <CompactionSection label={S.chat.compactionResult} text={summary} streaming={item.running} />
    </>
  ) : null;

  // The title carries the mode in both states, so the running row's detail slot is free for
  // the streaming hint (a summarize only: a discard has nothing to stream) instead of the
  // raw `summarize`/`discard` wire value.
  if (item.running) {
    return (
      <StepBanner
        state="running"
        title={S.chat.compactionTitle(item.mode)}
        {...(item.mode === "summarize" ? { detail: S.chat.compactionStreaming } : {})}
        {...(item.beginTsMs !== undefined ? { liveSinceMs: item.beginTsMs } : {})}
      >
        {body}
      </StepBanner>
    );
  }
  const ok = item.status === "completed";
  return (
    <StepBanner
      state={ok ? "done" : "failed"}
      title={S.chat.compactionTitle(item.mode)}
      // Success says everything through the title, the icon and the wall time; only a failure
      // still needs a line, because its reason is the part the title cannot carry.
      detail={ok ? undefined : S.chat.compactionFailed(item.status ?? "failed", item.errorMessage)}
      {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
    >
      {body}
    </StepBanner>
  );
}
