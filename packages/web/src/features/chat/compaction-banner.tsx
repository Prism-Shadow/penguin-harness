/**
 * Compaction row: one ActivityGroup of the event kind across running/done/failed (the activity
 * card, shared with the work group, the MCP connect row and the background and injected-message
 * notices) — the wall time ticks while it runs and settles once finished, failures stay on a
 * single line.
 *
 * **The title names the mode and doubles as the status**, the work-group header's idiom
 * (运行中 → 运行完毕): a `summarize` row reads 压缩中 / "Compacting" while it runs and
 * 压缩完毕 / "Compacted" once it settles; a `discard` row 清空中 → 清空完毕 ("Clearing" →
 * "Cleared") — it drops the old context rather than compacting it, and calling that
 * "compaction" was the confusing part (per maintainer request). With mode and state both in
 * the title neither outcome needs a detail line: a running row is icon + title + ticking wall
 * time (+ chevron on a summarize), a succeeded row the same with the time settled, and the
 * detail slot is left for the one thing a title cannot say — why a compaction failed, under
 * the bare mode word.
 *
 * The body follows the work group: **two stacked disclosure rows, each with its own status
 * icon and wall time exactly like a thinking block** — 「思考」/ "Thinking", what the
 * compaction request thought ahead of its summary (present only once any arrived; a model
 * that does not think leaves no empty row), and 「压缩结果」/ "Result", the summary itself.
 * Both carry the thinking block's own body (`md-body` + the streaming `Md`) and stream while
 * the request writes them.
 *
 * Two layers, and the running row opens exactly one of them (ActivityGroup's expand policy):
 * while the compaction runs the banner is open, so the two section rows are on
 * screen with their labels and their ticking times — the reader can see that they are there
 * and how long each is taking — while the sections themselves stay closed (DisclosureRow's
 * default), because their contents are the compaction's raw workings and not what the row is
 * for. Once the compaction settles the banner closes itself again, leaving the one-line
 * summary. The sections arrive in the order the request produces them: the thinking section
 * once any thinking lands, the result section only after that thinking finishes — its first
 * summary token is what settles the thinking section — so a running row never shows a result
 * row beside a thought still being written (compactionResultVisible decides).
 *
 * The header's chevron is there from the moment a summarize compaction starts, so the reader
 * can reopen it to watch the request work, or read the outcome afterwards. A `discard`
 * compaction produces no text at all and stays chevron-less, as does a failed one: a
 * compaction that did not complete wrote no adopted summary, and the reducer discards its
 * half-written drafts (see stream-model's compaction_end handling), so there is nothing left
 * to show.
 *
 * Doesn't show Tokens: the row only needs to state whether compaction happened and whether it
 * succeeded. Compaction's cost lands in different places depending on when it occurs — compaction
 * that happens **mid-turn** counts toward that turn's stats line and cost; compaction **after a
 * turn ends** and manual compaction both go into the Session total (the Trace page lists
 * compaction turns separately); see the task-stats module comments.
 */
import {
  ActivityGroup,
  DISCLOSURE_BODY_MD_CLASS,
  DisclosureRow,
  LiveDuration,
  Md,
  StatusIcon,
} from "@prismshadow/penguin-ui";
import type { ActivityGroupRow } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { humanizeDuration } from "../../lib/format";
import type { CompactionItem } from "../../lib/omni/stream-model";
import { compactionResultVisible, compactionSummaryText } from "../../lib/omni/compaction-summary";

/**
 * One body section: the thinking block's row (status icon + label + wall time + chevron) over
 * the thinking block's text body — the same three marks in the same order, so a compaction
 * section and a thinking block read as the one thing they are. Sticky like a row inside the
 * work group, so a long expanded section keeps its own label pinned under the stuck banner
 * header. Like the work group's rows it is an activity row hanging off the banner's head: the
 * thinking section names thinking, the summary is the compaction's own event.
 */
function CompactionSection({
  kind,
  label,
  text,
  streaming,
  startedAtMs,
  durationMs,
}: {
  kind: "thinking" | "event";
  label: string;
  text: string;
  streaming: boolean;
  /** Ticks from here while the section streams (`…` until its first content lands). */
  startedAtMs?: number;
  /** Settled wall time once the section closes (see CompactionItem for the boundaries). */
  durationMs?: number;
}) {
  return (
    <DisclosureRow
      sticky
      activity={{ kind, state: streaming ? "running" : "done" }}
      icon={
        <StatusIcon
          state={streaming ? "running" : "done"}
          label={streaming ? S.chat.workRunning : S.chat.workDone}
        />
      }
      label={label}
      trailing={
        <span data-slot="detail" className="shrink-0 font-mono text-xs text-fg-muted">
          {streaming ? (
            <LiveDuration sinceMs={startedAtMs} />
          ) : durationMs !== undefined ? (
            humanizeDuration(durationMs)
          ) : null}
        </span>
      }
    >
      <div className={`anim-fade ${DISCLOSURE_BODY_MD_CLASS}`}>
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
  // The sections hang off the banner's head as its rows, the work group's steps' anatomy.
  const rows: ActivityGroupRow[] = [];
  if (thinking !== "") {
    rows.push({
      key: "thinking",
      content: (
        <CompactionSection
          kind="thinking"
          label={S.chat.thinking}
          text={thinking}
          streaming={item.thinkingStreaming === true}
          startedAtMs={item.thinkingStartedAtMs}
          durationMs={item.thinkingDurationMs}
        />
      ),
    });
  }
  if (compactionResultVisible(item)) {
    rows.push({
      key: "result",
      content: (
        <CompactionSection
          kind="event"
          label={S.chat.compactionResult}
          text={summary}
          streaming={item.running}
          startedAtMs={item.summaryStartedAtMs}
          durationMs={item.summaryDurationMs}
        />
      ),
    });
  }

  // The title says both what runs and that it is running (压缩中 / "Compacting"), as the
  // work-group header's does; no detail line — the body streams behind the chevron, and the
  // raw `summarize`/`discard` wire value never shows.
  if (item.running) {
    return (
      <ActivityGroup
        kind="event"
        state="running"
        title={S.chat.compactionRunning(item.mode)}
        {...(item.beginTsMs !== undefined ? { startMs: item.beginTsMs } : {})}
        {...(expandable ? { rows } : {})}
      />
    );
  }
  const ok = item.status === "completed";
  return (
    <ActivityGroup
      kind="event"
      state={ok ? "done" : "failed"}
      // Success says everything through the title (压缩完毕 / "Compacted"), the icon and the
      // wall time; a failure keeps the bare mode word and needs a line, because its reason is
      // the part a title cannot carry.
      title={ok ? S.chat.compactionDone(item.mode) : S.chat.compactionTitle(item.mode)}
      detail={ok ? undefined : S.chat.compactionFailed(item.status ?? "failed", item.errorMessage)}
      {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
      {...(expandable ? { rows } : {})}
    />
  );
}
