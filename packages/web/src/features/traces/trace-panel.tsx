/**
 * Trace panel — the current conversation's Trace files as a dock tab, wrapping the shared
 * file view (performance timeline + event list) around one Session. The file pills page
 * newest-first; the export link downloads the selected file raw. This is the ONLY way to
 * read a Trace: the standalone cross-Session browsing page is gone, so a Trace is read
 * where it was produced, as the "what did this conversation do" view. Importing a Trace
 * from another install is the one thing that outlived the page — it moved to System
 * settings, beside the CLI-sessions filter.
 *
 * Loading is gated on `active` (the dock keeps inactive tabs mounted): the listing is
 * fetched on the first show, re-fetched on every re-show, and re-fetched again whenever a
 * turn settles while the tab IS showing. So the Trace grows under the eye watching it, and a
 * Task that finished while the tab was hidden still appears on return without a manual
 * refresh — while a hidden tab fetches nothing. trace-refresh.ts states the rule exactly.
 */
import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { DownloadIcon } from "../../components/ui/icons";
import { EmptyState } from "../../components/ui/empty-state";
import { Skeleton } from "../../components/ui/skeleton";
import { ICON_SIZE } from "../../lib/icon-scale";
import { TraceFileView } from "./trace-file-view";
import {
  activeTraceFile,
  advanceTraceRefresh,
  createTraceRefresh,
  sortTraceFiles,
} from "./trace-refresh";
import type { TraceHighlight } from "./timeline-chart";

/** File pills rendered before the "+N" overflow control expands them (a long Session can hold dozens of compaction shards). */
const FILE_PILL_CAP = 6;

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
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);

  // Fetch on show, and again on every settled turn while showing (trace-refresh.ts owns the
  // rule; a signal arriving while hidden is dropped and the re-show edge covers it). Split
  // into an edge tracker that bumps a tick and a fetch effect keyed on that tick — a single
  // edge-detecting fetch effect would lose the FIRST load under StrictMode's dev-mode
  // double-invoke (the tracker advances on the first run, whose fetch the cleanup cancels;
  // the second run then sees no edge and never refetches, leaving the skeleton up forever).
  // The selected pill survives a re-list while its file still exists; a vanished selection
  // falls back to the newest file.
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
        setFiles(sortTraceFiles(res.files));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFiles([]);
        setError(apiErrorText(err));
      });
    return () => {
      cancelled = true;
    };
    // listTick re-runs the fetch on every re-show and on every settled turn while showing;
    // `active` alone would only load once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, listTick, session.sessionId]);

  if (files === null) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    );
  }

  if (error !== null) {
    return <EmptyState title={S.tracePanel.loadFailed} description={error} />;
  }

  // null only when the Session has produced no Trace at all: a re-list that dropped the
  // selected file falls back to the newest one rather than emptying the panel.
  const activeFile = activeTraceFile(files, fileIndex);
  if (activeFile === null) {
    return <EmptyState title={S.tracePanel.empty} description={S.tracePanel.emptyHint} />;
  }

  const visibleFiles = showAllFiles ? files : files.slice(0, FILE_PILL_CAP);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-gray-400">{S.traces.filesTitle}</span>
          {visibleFiles.map((f) => (
            <button
              key={f.index}
              type="button"
              onClick={() => setFileIndex(f.index)}
              title={`${f.date} · ${formatBytes(f.sizeBytes)}`}
              className={`rounded-md border px-2 py-0.5 font-mono text-xs transition-colors duration-150 ${
                f.index === activeFile.index
                  ? "border-gray-400 bg-gray-200/70 font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  : "border-gray-200 text-gray-500 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60"
              }`}
            >
              #{String(f.index).padStart(3, "0")}
            </button>
          ))}
          {!showAllFiles && files.length > FILE_PILL_CAP && (
            <button
              type="button"
              title={S.chat.loadMore}
              aria-label={S.chat.loadMore}
              onClick={() => setShowAllFiles(true)}
              className="rounded-md border border-gray-200 px-2 py-0.5 font-mono text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60"
            >
              +{files.length - FILE_PILL_CAP}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-xs text-gray-400">
            {activeFile.date} · {formatBytes(activeFile.sizeBytes)}
          </p>
          {/* Raw-file download for the selected Trace file (same styling as the inactive pills). */}
          <a
            href={api.agentTraceDownloadUrl(
              session.projectId,
              session.agentId,
              session.sessionId,
              activeFile.index,
            )}
            download
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60"
          >
            <DownloadIcon size={ICON_SIZE.rowLead} />
            {S.traces.exportFile}
          </a>
        </div>

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
        />
      </div>
    </div>
  );
}
