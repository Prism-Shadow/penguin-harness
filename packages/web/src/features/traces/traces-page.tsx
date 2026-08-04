/**
 * Trace browsing page: the left-side directory lists Sessions grouped only by
 * Agent (paged like the chat sidebar and reusing its grouping helpers; titles are
 * server-resolved — DB title or first-prompt fallback — with the Sessions store
 * overriding when it has a fresher one, and raw session ids never render); the
 * right side shows the selected Session's Trace files (paged, most recent first
 * by default) + performance analysis (an execution timeline) + an event timeline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useSearchParams } from "react-router";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatBytes } from "../../lib/format";
import {
  SIDEBAR_GROUP_PAGE_SIZE,
  SIDEBAR_PAGE_SIZE,
  pinnedFirst,
  splitPage,
} from "../../lib/session-grouping";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Chevron } from "../../components/ui/chevron";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { DownloadIcon, UploadIcon } from "../../components/ui/icons";
import { toastError } from "../../components/ui/toast";
import { Truncated } from "../../components/ui/truncated";
import { useSessions } from "../../state/sessions";
import { EmptyState } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { TraceFileView } from "./trace-file-view";
import type { TraceHighlight } from "./timeline-chart";
import { appendSessionGroups, toSessionGroups } from "./trace-sessions";
import type { TraceFileRef, TraceSessionGroup } from "./trace-sessions";

/**
 * Import file size cap, mirroring the server's route-side limit (agent-traces.ts).
 * Checked on the raw picked file before it is read: base64-encoding an oversized
 * pick and uploading it just to receive the server's 400 would materialize and
 * send many times the cap for nothing.
 */
const MAX_TRACE_BYTES = 14 * 1024 * 1024;

/** File pills rendered before the "+N" overflow control expands them (a long Session can hold dozens of compaction shards). */
const FILE_PILL_CAP = 10;

/** "More"-style row (sessions "load more" / "more groups"), matching the sidebar's folder row styling. */
const MORE_ROW_CLASS =
  "flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium text-gray-400 transition-colors duration-150 hover:bg-gray-200/50 dark:text-gray-500 dark:hover:bg-gray-800/50";

interface Selection {
  /** Details go through the Agent-level endpoint (not dependent on the sessions table's tracking), so the owning Agent must be carried along. */
  agentId: string;
  sessionId: string;
  /** Server-resolved title of the selected group (the header still prefers a fresher store title). */
  title?: string;
  files: TraceFileRef[];
}

/** A single Agent's expandable tree node (traces are fetched only when expanded, one sidebar-sized page at a time). */
function AgentNode({
  projectId,
  agentId,
  name,
  defaultOpen,
  focusSessionId,
  canImport,
  titleOf,
  selection,
  onSelect,
}: {
  projectId: string;
  agentId: string;
  name: string;
  /** Initial expanded state: only the first Agent when there's no deep link; only the target Agent when there's an ?agentId= deep link. */
  defaultOpen: boolean;
  /** ?sessionId= deep link (jumped to directly from the evaluation center's runs): auto-selects that Session once the list is ready (only once). */
  focusSessionId?: string;
  /** Trace import is owner-only on the server; non-owners don't get the button. */
  canImport: boolean;
  /** Display title (store title -> server title -> default); never a raw session id. */
  titleOf: (sessionId: string, serverTitle?: string) => string;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [groups, setGroups] = useState<TraceSessionGroup[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  /** Session to auto-select once the refreshed list arrives (the import response's sessionId). */
  const importedSession = useRef<string | null>(null);

  const toSelection = useCallback(
    (g: TraceSessionGroup): Selection => ({
      agentId,
      sessionId: g.sessionId,
      ...(g.title !== undefined ? { title: g.title } : {}),
      files: g.files,
    }),
    [agentId],
  );

  /**
   * Selects a Session that isn't in the loaded pages (a deep link to, or re-import of,
   * an old Session): one legacy full fetch resolves its files. That is the pre-paging
   * cost of the whole tree, but for a single Agent and only on this path; a miss stays
   * silent, like the old in-list miss.
   */
  const selectFromFull = useCallback(
    (sessionId: string) => {
      api
        .getAgentTraces(projectId, agentId)
        .then((data) => {
          const target = toSessionGroups(data).find((g) => g.sessionId === sessionId);
          if (target) onSelect(toSelection(target));
        })
        .catch(() => {});
    },
    [projectId, agentId, onSelect, toSelection],
  );

  // First page, fetched only while the node is open with nothing loaded (a collapsed
  // node costs the server nothing — with many Agents the old load-everything mount
  // fanned out one full directory scan per Agent).
  useEffect(() => {
    if (!open || groups) return;
    api
      .getAgentTraces(projectId, agentId, { offset: 0, limit: SIDEBAR_PAGE_SIZE + 1 })
      .then((data) => {
        const page = splitPage(toSessionGroups(data), SIDEBAR_PAGE_SIZE);
        setGroups(page.items);
        setHasMore(page.hasMore);
      })
      .catch((e: unknown) => setError(apiErrorText(e)));
  }, [open, groups, projectId, agentId]);

  /** Next server page appended onto the list (deduped by sessionId — new Sessions shift the server's offsets). */
  const loadMore = useCallback(() => {
    if (!groups || loadingMore) return;
    setLoadingMore(true);
    api
      .getAgentTraces(projectId, agentId, { offset: groups.length, limit: SIDEBAR_PAGE_SIZE + 1 })
      .then((data) => {
        const page = splitPage(toSessionGroups(data), SIDEBAR_PAGE_SIZE);
        setGroups((prev) => appendSessionGroups(prev ?? [], page.items));
        setHasMore(page.hasMore);
      })
      // Transient action failure -> toast (the load-state-with-content rule applies to
      // the initial load; an already-rendered list stays).
      .catch((e: unknown) => toastError(apiErrorText(e)))
      .finally(() => setLoadingMore(false));
  }, [groups, loadingMore, projectId, agentId]);

  // The Session deep link is applied only once: it selects the target as soon as the
  // list is first ready (falling back to a full fetch when the target sorts beyond the
  // first page); after that, the user's manual switches are never pulled back by the
  // deep-link parameter.
  const focusApplied = useRef(false);
  useEffect(() => {
    if (focusApplied.current || !focusSessionId || !groups) return;
    focusApplied.current = true;
    const target = groups.find((g) => g.sessionId === focusSessionId);
    if (target) onSelect(toSelection(target));
    else selectFromFull(focusSessionId);
  }, [groups, focusSessionId, onSelect, toSelection, selectFromFull]);

  // Post-import selection: once the refreshed list is in, select the imported Session —
  // an import always creates a new Session whose only file is the imported one, so the
  // default file pick is the imported file. A re-imported OLD session id can sort beyond
  // the refreshed first page; the full-fetch fallback still selects it.
  useEffect(() => {
    const sid = importedSession.current;
    if (sid === null || !groups) return;
    importedSession.current = null;
    const target = groups.find((g) => g.sessionId === sid);
    if (target) onSelect(toSelection(target));
    else selectFromFull(sid);
  }, [groups, onSelect, toSelection, selectFromFull]);

  const runImport = async (dataBase64: string) => {
    setImporting(true);
    try {
      const res = await api.importAgentTrace(projectId, agentId, { dataBase64 });
      // Drop the cached list so the fetch effect above reloads it; the effect
      // watching `groups` then jumps to the imported Session.
      importedSession.current = res.sessionId;
      setGroups(null);
      setHasMore(false);
      setOpen(true);
    } catch (e: unknown) {
      // Transient action failure → toast (the app's one notification rule; a
      // rejected import isn't a state of the tree, unlike the load error below).
      toastError(apiErrorText(e));
    } finally {
      setImporting(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset before reading so re-picking the same file fires change again.
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_TRACE_BYTES) {
      toastError(S.traces.fileTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      void runImport(url.slice(url.indexOf(",") + 1)); // strip the data:...;base64, prefix
    };
    reader.onerror = () => toastError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  // The group header and Session row styling matches the sidebar
  // (components/layout/sidebar.tsx): the same information appearing in two
  // places with a different shape would make it look like two different things.
  return (
    <li className="pt-2.5">
      <div className="flex items-center px-1 pb-0.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? S.nav.collapseGroup : S.nav.expandGroup}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
        >
          <AgentAvatar id={agentId} name={name} size={18} className="shrink-0 rounded" />
          <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {name}
          </span>
          {/* Expand/collapse indicator immediately follows the Agent name */}
          <Chevron open={open} size={12} className="text-gray-400" />
          <span className="min-w-0 flex-1" />
        </button>
        {canImport && (
          <label
            title={importing ? S.traces.importing : S.traces.importTrace}
            className={`shrink-0 cursor-pointer rounded p-1 text-gray-400 transition-colors duration-150 hover:bg-gray-200/50 hover:text-gray-600 dark:hover:bg-gray-800/50 dark:hover:text-gray-300 ${
              importing ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <HiddenFileInput accept=".jsonl" disabled={importing} onChange={onPickFile} />
            <UploadIcon size={13} />
            <span className="sr-only">{importing ? S.traces.importing : S.traces.importTrace}</span>
          </label>
        )}
      </div>
      {open && (
        <div className="anim-fade">
          {/* Load failure of the tree itself stays inline (the one-notification-rule keeps load states with their content, not in a disappearing toast). */}
          {error && <p className="px-2.5 py-1 text-xs text-red-500">{error}</p>}
          {!groups && !error && (
            <p className="px-2.5 py-1 text-xs text-gray-400">{S.common.loading}</p>
          )}
          {groups && groups.length === 0 && (
            <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">{S.traces.empty}</p>
          )}
          <ul className="space-y-0.5">
            {groups?.map((g) => {
              const active = selection?.agentId === agentId && selection.sessionId === g.sessionId;
              return (
                <li key={g.sessionId}>
                  <button
                    type="button"
                    onClick={() => onSelect(toSelection(g))}
                    className={`flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 ${
                      active
                        ? "bg-gray-200/70 dark:bg-gray-800"
                        : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
                    }`}
                  >
                    <Truncated
                      text={titleOf(g.sessionId, g.title)}
                      className={`min-w-0 flex-1 text-sm ${
                        active
                          ? "font-medium text-gray-900 dark:text-gray-100"
                          : "text-gray-700 dark:text-gray-300"
                      }`}
                    />
                    <span className="shrink-0 font-mono text-[11px] text-gray-400">
                      {g.files.length}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* Load the next server page (kept adjacent to the list it extends, mirroring the sidebar's "More"). */}
          {groups && hasMore && (
            <button
              type="button"
              aria-label={S.chat.loadMore}
              disabled={loadingMore}
              onClick={loadMore}
              className={`${MORE_ROW_CLASS} mt-0.5 disabled:opacity-60`}
            >
              <span className="w-3" aria-hidden />
              {loadingMore ? S.common.loading : S.chat.loadMore}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function TracesPage() {
  useDocumentTitle(S.traces.title);
  const { currentProject, agents, agentsLoading } = useProject();
  const { byAgent } = useSessions();
  const projectId = currentProject?.projectId ?? null;
  // ?agentId= deep link (from the Agents page's "traces" entry point): only
  // the target Agent defaults to expanded, the rest collapse to keep focus on it.
  const [searchParams] = useSearchParams();
  const focusAgentId = searchParams.get("agentId");
  // ?sessionId= deep link (jumped to directly from the evaluation center's
  // runs): auto-selects once the target Agent's Session list is ready.
  const focusSessionId = searchParams.get("sessionId");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fileIndex, setFileIndex] = useState<number | null>(null);
  /** Rendered Agent groups cap (the sidebar's group paging pattern: raised a page per "more groups" click). */
  const [agentCap, setAgentCap] = useState(SIDEBAR_GROUP_PAGE_SIZE);
  /** File-pill overflow expanded for the current selection. */
  const [showAllFiles, setShowAllFiles] = useState(false);
  // Linked highlighting between the trace observation view and the event list (keyed by tool_call_id).
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);

  // Clear the selection when switching Project.
  useEffect(() => {
    setSelection(null);
    setFileIndex(null);
    setAgentCap(SIDEBAR_GROUP_PAGE_SIZE);
  }, [projectId]);

  // Clear the linked highlight when switching Session / Trace file.
  useEffect(() => {
    setHighlight(null);
  }, [selection, fileIndex]);

  // Collapse the file-pill overflow when switching Session (picking a pill must not re-collapse the row it lives in).
  useEffect(() => {
    setShowAllFiles(false);
  }, [selection]);

  /**
   * sessionId -> freshest store title (live session_title pushes land in the Sessions
   * store first). Memoized Map: the old per-row `.find` re-scanned the store list on
   * every render of every row.
   */
  const storeTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const list of byAgent.values()) {
      for (const s of list) if (s.title !== undefined) m.set(s.sessionId, s.title);
    }
    return m;
  }, [byAgent]);

  /** Display title: store title (freshest) -> server-resolved title -> default. Raw session ids never render as text. */
  const titleOf = useCallback(
    (sessionId: string, serverTitle?: string): string =>
      storeTitles.get(sessionId) ?? serverTitle ?? S.chat.defaultSessionTitle,
    [storeTitles],
  );

  // The ?agentId= focus target is pinned first so the deep link stays visible above the
  // group cap (the sidebar's pinnedFirst, with the deep link as the pinned set).
  const orderedAgents = useMemo(
    () =>
      pinnedFirst(agents, (a) => a.agentId, new Set(focusAgentId === null ? [] : [focusAgentId])),
    [agents, focusAgentId],
  );

  if (!projectId) return null;

  const activeFile =
    selection === null
      ? null
      : (selection.files.find((f) => f.index === fileIndex) ?? selection.files[0] ?? null);
  const visibleFiles =
    selection === null || showAllFiles ? null : selection.files.slice(0, FILE_PILL_CAP);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Directory tree: Agent → Session title (≥md left column; <md top collapsible area).
          relative: a scroller is its own containing block — the invariant and the failure it
          prevents are documented in styles.css; this is where it first bit (an Agent node past
          the fold put its import control's absolutely positioned box at a document-level
          offset, growing the document). */}
      <aside className="relative max-h-52 shrink-0 overflow-y-auto border-b border-gray-200 bg-gray-50 px-1 py-2 md:max-h-none md:w-72 md:border-b-0 md:border-r dark:border-gray-800 dark:bg-gray-900">
        <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-gray-500">
          {S.traces.title}
        </p>
        {agentsLoading ? (
          <SkeletonList rows={4} />
        ) : (
          <>
            <ul>
              {orderedAgents.slice(0, agentCap).map((a, i) => (
                <AgentNode
                  key={a.agentId}
                  projectId={projectId}
                  agentId={a.agentId}
                  name={agentDisplayName(a)}
                  // Exactly one Agent auto-expands (its page-one fetch runs on mount): the
                  // deep-link target, or the first Agent without a deep link — expanding
                  // all of them fanned out one directory scan per Agent on page load.
                  defaultOpen={focusAgentId === null ? i === 0 : focusAgentId === a.agentId}
                  {...(focusSessionId !== null && focusAgentId === a.agentId
                    ? { focusSessionId }
                    : {})}
                  canImport={currentProject?.role === "owner"}
                  titleOf={titleOf}
                  selection={selection}
                  onSelect={(sel) => {
                    setSelection(sel);
                    setFileIndex(sel.files[0]?.index ?? null);
                  }}
                />
              ))}
            </ul>
            {/* Reveal-next-page-of-groups row (render cap only — collapsed Agents load nothing anyway). */}
            {orderedAgents.length > agentCap && (
              <button
                type="button"
                onClick={() => setAgentCap((c) => c + SIDEBAR_GROUP_PAGE_SIZE)}
                className={`${MORE_ROW_CLASS} mt-1`}
              >
                <span className="w-3" aria-hidden />
                {S.chat.moreGroups(orderedAgents.length - agentCap)}
              </button>
            )}
          </>
        )}
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto p-3 md:p-4">
        {selection && activeFile ? (
          <div className="mx-auto max-w-4xl space-y-4">
            {/* Header: Session title + Trace file pagination (newest first) */}
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                {titleOf(selection.sessionId, selection.title)}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-xs text-gray-400">{S.traces.filesTitle}</span>
                {(visibleFiles ?? selection.files).map((f) => (
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
                {/* Overflow control: reveals the remaining pills (styled like an inactive pill). */}
                {visibleFiles !== null && selection.files.length > FILE_PILL_CAP && (
                  <button
                    type="button"
                    title={S.chat.loadMore}
                    aria-label={S.chat.loadMore}
                    onClick={() => setShowAllFiles(true)}
                    className="rounded-md border border-gray-200 px-2 py-0.5 font-mono text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60"
                  >
                    +{selection.files.length - FILE_PILL_CAP}
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Date · size only — the session id stays in the data (selection, deep links) but never renders as text. */}
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-gray-400">
                {activeFile.date} · {formatBytes(activeFile.sizeBytes)}
              </p>
              {/* Raw-file download for the selected Trace file (same styling as the inactive file pills). */}
              <a
                href={api.agentTraceDownloadUrl(
                  projectId,
                  selection.agentId,
                  selection.sessionId,
                  activeFile.index,
                )}
                download
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60"
              >
                <DownloadIcon size={12} />
                {S.traces.exportFile}
              </a>
            </div>

            <TraceFileView
              projectId={projectId}
              agentId={selection.agentId}
              sessionId={selection.sessionId}
              index={activeFile.index}
              highlight={highlight}
              onHighlight={setHighlight}
            />
          </div>
        ) : (
          <EmptyState title={S.traces.selectSession} />
        )}
      </section>
    </div>
  );
}
