/**
 * Compaction row: one StepBanner across running/done/failed (same shell as the MCP
 * connect row and the reasoning-&-tools group header) — wall time once settled, failures
 * on a single line.
 *
 * **The title names the mode**, so the two modes read as the two different things they are:
 * a `summarize` row is 压缩 / "Compaction", a `discard` row is 清空 / "Clear" — it drops the
 * old context rather than compacting it, and calling that "compaction" was the confusing part
 * (per maintainer request). With the mode in the title neither outcome needs a detail line:
 * a succeeded row is icon + title + wall time (+ chevron on a summarize), and the detail slot
 * is left for the one thing the title cannot say — why a compaction failed.
 *
 * The summary is **collapsed by default, exactly like a thinking block**: the row carries
 * the chevron from the moment a summarize compaction starts, and the text the compaction
 * request is writing streams inside the collapsed body (same `md-body` treatment and the
 * same streaming `Md` as thinking-block.tsx) — the reader expands it to watch the summary
 * being written, or to read it afterwards. A `discard` compaction produces no text at all
 * and stays chevron-less, as does a failed one: a compaction that did not complete wrote
 * no adopted summary, and the reducer discards its half-written draft (see stream-model's
 * compaction_end handling), so there is nothing left to show.
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
import { Md } from "./md";
import { StepBanner } from "./step-banner";

/** The expandable body: the same shell thinking uses for its own text (md-body + streaming Md). */
function SummaryBody({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="md-body px-3 py-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
      <Md text={text} streaming={streaming} />
    </div>
  );
}

export function CompactionBanner({ item }: { item: CompactionItem }) {
  const summary = compactionSummaryText(item);
  // The chevron is stable for the whole life of a summarize compaction: present from the
  // start (before the first token arrives the body is simply empty, as a thinking block's
  // is) rather than appearing mid-stream and shifting the row.
  const expandable = summary !== "" || (item.running && item.mode === "summarize");
  const body = expandable ? <SummaryBody text={summary} streaming={item.running} /> : null;

  // The title carries the mode in both states, so the running row no longer repeats it as a
  // raw `summarize`/`discard` in the detail slot — that was the untranslated wire value.
  if (item.running) {
    return (
      <StepBanner
        state="running"
        title={S.chat.compactionTitle(item.mode)}
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
