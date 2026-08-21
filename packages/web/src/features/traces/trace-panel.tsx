/**
 * Trace panel — the current conversation's Trace files as a dock tab, reusing the traces
 * page's file view (performance timeline + event list) scoped to one Session. The file
 * pills page newest-first; the export link downloads the selected file raw. Cross-Session
 * browsing stays on the /traces page (deep-linked from the Agents page and the details
 * popover) — this panel is the "what did this conversation do" view.
 *
 * Loading is gated on `active` (the dock keeps inactive tabs mounted): the listing is
 * fetched on the first show and re-fetched on every re-show, so a Task that finished while
 * the tab was hidden appears on return without a manual refresh.
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
import type { TraceHighlight } from "./timeline-chart";

/** File pills rendered before the "+N" overflow control expands them (a long Session can hold dozens of compaction shards). */
const FILE_PILL_CAP = 6;

interface FileRef {
  index: number;
  date: string;
  sizeBytes: number;
}

export function TracePanel({ session, active }: { session: SessionInfo; active: boolean }) {
  const [files, setFiles] = useState<FileRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileIndex, setFileIndex] = useState<number | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);

  // Fetch on show: first activation loads, later activations re-list (a Task may have
  // written a new file meanwhile). The selected pill survives a re-list when its file
  // still exists; a vanished selection falls back to the newest file.
  const prevActive = useRef(false);
  useEffect(() => {
    const becameActive = active && !prevActive.current;
    prevActive.current = active;
    if (!becameActive) return;
    let cancelled = false;
    void api
      .getSessionTraces(session.sessionId)
      .then((res) => {
        if (cancelled) return;
        // Newest first: the pill row and the default selection both read left-to-right
        // from the most recent context.
        setFiles([...res.files].sort((a, b) => b.index - a.index));
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
  }, [active, session.sessionId]);

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

  if (files.length === 0) {
    return <EmptyState title={S.tracePanel.empty} description={S.tracePanel.emptyHint} />;
  }

  const activeFile = files.find((f) => f.index === fileIndex) ?? files[0]!;
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

        <TraceFileView
          projectId={session.projectId}
          agentId={session.agentId}
          sessionId={session.sessionId}
          index={activeFile.index}
          highlight={highlight}
          onHighlight={setHighlight}
        />
      </div>
    </div>
  );
}
