import { S } from "@prismshadow/penguin-web/internal";
import { humanizeDuration } from "@prismshadow/penguin-web/internal";
import type { CompactionItem } from "@prismshadow/penguin-web/internal";
import { compactionResultVisible, compactionSummaryText } from "@prismshadow/penguin-web/internal";


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
      <StreamText className={DISCLOSURE_BODY_MD_CLASS} text={text} streaming={streaming} />
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
