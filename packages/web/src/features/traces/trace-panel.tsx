/**
 * Trace panel — the current conversation's Trace files as a dock tab, wrapping the shared
 * file view (performance timeline + event list) around one Session. The view's sticky toolbar
 * carries the panel's two controls: the file — a picker over the files, newest first, when the
 * Session has more than one (the toolbar's dropdown, the same one the round navigator is), else
 * the one file's label — and the export icon, which downloads the selected file raw. This is the
 * ONLY way to read a Trace: the standalone cross-Session browsing page is gone, so a Trace is
 * read where it was produced, as the "what did this conversation do" view. Importing a Trace
 * from another install is the one thing that outlived the page — it moved to System settings,
 * beside the CLI-sessions filter.
 *
 * Loading is gated on `active` (the dock keeps inactive tabs mounted): the listing is
 * fetched on the first show, re-fetched on every re-show, and re-fetched again whenever a
 * turn settles while the tab IS showing. So the Trace grows under the eye watching it, and a
 * Task that finished while the tab was hidden still appears on return without a manual
 * refresh — while a hidden tab fetches nothing. trace-refresh.ts states the rule exactly.
 */
import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  DownloadIcon,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  NoticeStrip,
  Skeleton,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { TraceFileView } from "./trace-file-view";
import { TracePicker } from "./trace-picker";
import {
  activeTraceFile,
  advanceTraceRefresh,
  createTraceRefresh,
  sortTraceFiles,
} from "./trace-refresh";
import type { TraceHighlight } from "./timeline-chart";

interface FileRef {
  index: number;
  date: string;
  sizeBytes: number;
}

export function TracePanel({
  session,
  active,
  reloadSignal,
}: {
  session: SessionInfo;
  /** Whether the dock tab is showing; a hidden tab stays mounted and fetches nothing. */
  active: boolean;
  /**
   * The chat page's settled-turn counter, the same one the Files panel reads: bumped every time
   * a Task settles on this Session. A bump while the panel is showing re-lists the files and
   * re-reads the selected one — a Trace file GROWS during a run, so the ordinary refresh is the
   * same file at a larger size, not a new file appearing.
   */
  reloadSignal: number;
}) {
  const [files, setFiles] = useState<FileRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileIndex, setFileIndex] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);

  // Fetch on show, and again on every settled turn while showing (trace-refresh.ts owns the
  // rule; a signal arriving while hidden is dropped and the re-show edge covers it). Split
  // into an edge tracker that bumps a tick and a fetch effect keyed on that tick — a single
  // edge-detecting fetch effect would lose the FIRST load under StrictMode's dev-mode
  // double-invoke (the tracker advances on the first run, whose fetch the cleanup cancels;
  // the second run then sees no edge and never refetches, leaving the skeleton up forever).
  // The selected file survives a re-list while it still exists; a vanished selection
  // falls back to the newest file, and the default is pinned to a real index as soon as the
  // first listing arrives rather than left to that fallback.
  const [listTick, setListTick] = useState(0);
  const refresh = useRef(createTraceRefresh({ active, signal: reloadSignal }));
  useEffect(() => {
    if (advanceTraceRefresh(refresh.current, { active, signal: reloadSignal })) {
      setListTick((t) => t + 1);
    }
  }, [active, reloadSignal]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void api
      .getSessionTraces(session.sessionId)
      .then((res) => {
        if (cancelled) return;
        const sorted = sortTraceFiles(res.files);
        setFiles(sorted);
        // Pin the default the first time a listing arrives. Left as null the selection is
        // "whatever activeTraceFile falls back to" — the newest file, re-resolved on every
        // re-list — so a compaction shard appearing mid-run would move a reader who never
        // picked a file onto the new one, remounting the view below onto a different index
        // and taking its open rounds, pinned row and scroll position with it. Pinned,
        // only a pick moves the selection.
        setFileIndex((cur) => cur ?? sorted[0]?.index ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // The listing already on screen is kept: this fires on every settled turn now, so a
        // blip mid-read must not unmount the picker and the view below it. Only a first load
        // (files still null) has nothing to fall back to.
        setError(apiErrorText(err));
      });
    return () => {
      cancelled = true;
    };
    // listTick re-runs the fetch on every re-show and on every settled turn while showing;
    // `active` alone would only load once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, listTick, session.sessionId]);

  // The failure owns the whole panel only where there is nothing to keep: no listing yet
  // (here), or a listing with no file in it (below). With a file on screen it is a strip
  // above it instead.
  if (files === null) {
    if (error !== null) return <EmptyState title={S.tracePanel.loadFailed} description={error} />;
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    );
  }

  // null only when the Session has produced no Trace at all: a re-list that dropped the
  // selected file falls back to the newest one rather than emptying the panel.
  const activeFile = activeTraceFile(files, fileIndex);
  if (activeFile === null) {
    if (error !== null) return <EmptyState title={S.tracePanel.loadFailed} description={error} />;
    return <EmptyState title={S.tracePanel.empty} description={S.tracePanel.emptyHint} />;
  }

  /** A file as the picker names it: its number and its date (its size is the row's note). */
  const fileName = (f: FileRef): string => `#${String(f.index).padStart(3, "0")} · ${f.date}`;
  // One file has nothing to pick from: its label says which it is, with its size, in the
  // picker's glyph and padding so the toolbar reads the same either way.
  const fileControl =
    files.length > 1 ? (
      <TracePicker
        slot="file-button"
        glyph={ICONS.file}
        label={fileName(activeFile)}
        title={S.traces.filesTitle}
        count={S.traces.fileCount(files.length)}
        align="left"
        width="18rem"
        rows={files.map((f) => ({
          key: f.index,
          label: fileName(f),
          trailing: (
            <span className="shrink-0 text-fg-muted tabular-nums">{formatBytes(f.sizeBytes)}</span>
          ),
        }))}
        current={activeFile.index}
        onPick={setFileIndex}
      />
    ) : (
      <span className="flex min-w-0 items-center gap-1 px-2.5 py-1 text-xs text-fg-muted">
        <GlyphIcon d={ICONS.file} size={ICON_SIZE.rowLead} />
        <span className="min-w-0 truncate tabular-nums">
          {fileName(activeFile)} · {formatBytes(activeFile.sizeBytes)}
        </span>
      </span>
    );
  // Raw-file download for the selected Trace file: a flat icon, named by its tooltip.
  const exportControl = (
    <a
      href={api.agentTraceDownloadUrl(
        session.projectId,
        session.agentId,
        session.sessionId,
        activeFile.index,
      )}
      download
      aria-label={S.traces.exportFile}
      data-tooltip={S.traces.exportFile}
      className="flex shrink-0 items-center justify-center rounded-control p-1.5 text-fg-muted transition-colors duration-150 hover:bg-control-hover hover:text-fg"
    >
      <DownloadIcon size={ICON_SIZE.iconButton} />
    </a>
  );

  // The scroll box is the toolbar's sticking container and the scroll the view's round-in-view
  // label follows (`data-scroll-box`). No top padding: the toolbar sits flush with the top edge.
  return (
    <div data-scroll-box className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {/* A re-list that failed keeps everything below it and says so here; the listing on
          screen is the last one that arrived, so it may be a turn or two behind. */}
      {error !== null && (
        <NoticeStrip tone="danger" as="p" className="mt-3 rounded-md border px-2.5 py-1.5 text-xs">
          {S.tracePanel.loadFailed} · {error}
        </NoticeStrip>
      )}
      {/* The listing tick doubles as the view's re-read signal: every edge that re-lists
          (a re-show, a settled turn while showing) also re-reads the selected file, since
          the usual change is this same file having grown rather than a new one appearing. */}
      <TraceFileView
        projectId={session.projectId}
        agentId={session.agentId}
        sessionId={session.sessionId}
        index={activeFile.index}
        reloadSignal={listTick}
        highlight={highlight}
        onHighlight={setHighlight}
        toolbarStart={fileControl}
        toolbarEnd={exportControl}
      />
    </div>
  );
}
