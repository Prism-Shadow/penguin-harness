/**
 * Trace browsing page. The left-side directory mirrors the chat sidebar's structure on
 * the shared grouped-list building blocks (components/ui/group-list.tsx): the same two
 * grouping modes behind the same persisted preference (by Workspace — the default — or
 * by Agent), group bodies split into the active list plus the collapsed lazy
 * subagent / scheduled / archived folders, and the same "More" paging rows. Data comes
 * from the paginated traces endpoint (paged per (Agent, category), see use-trace-tree),
 * so CLI/subagent Sessions stay visible — this page is the observability surface.
 * Titles are server-resolved (DB title or first-prompt fallback) with the Sessions
 * store overriding when it has a fresher one; raw session ids never render. The right
 * side shows the selected Session's Trace files (paged, most recent first by default) +
 * performance analysis (an execution timeline) + an event timeline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { SessionCategory, SessionCategoryCounts } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatBytes } from "../../lib/format";
import {
  FOLDER_CATEGORIES,
  aggregateWorkspaceCounts,
  groupSessionsByWorkspace,
  pinnedFirst,
} from "../../lib/session-grouping";
import type { FolderCategory } from "../../lib/session-grouping";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import {
  FOLDER_ICON,
  FOLDER_OPEN_ICON,
  FolderSection,
  GroupHeader,
  GroupModeToggle,
  Icon,
  MoreRow,
  initialGroupMode,
  storeGroupMode,
} from "../../components/ui/group-list";
import type { GroupMode } from "../../components/ui/group-list";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { DownloadIcon, UploadIcon } from "../../components/ui/icons";
import { toastError } from "../../components/ui/toast";
import { Truncated } from "../../components/ui/truncated";
import { useSessions } from "../../state/sessions";
import { EmptyState } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { TraceFileView } from "./trace-file-view";
import type { TraceHighlight } from "./timeline-chart";
import {
  TRACES_GROUP_PAGE_SIZE,
  TRACES_PAGE_SIZE,
  partitionTraceRows,
  toSessionGroups,
} from "./trace-sessions";
import type { TraceFileRef, TraceSessionRow } from "./trace-sessions";
import { useTraceTree } from "./use-trace-tree";

/**
 * Import file size cap, mirroring the server's route-side limit (agent-traces.ts).
 * Checked on the raw picked file before it is read: base64-encoding an oversized
 * pick and uploading it just to receive the server's 400 would materialize and
 * send many times the cap for nothing.
 */
const MAX_TRACE_BYTES = 14 * 1024 * 1024;

/** File pills rendered before the "+N" overflow control expands them (a long Session can hold dozens of compaction shards). */
const FILE_PILL_CAP = 10;

/** Open-state key of a collapsed folder inside a group ("\0" never appears in Agent ids or Workspace paths — the sidebar's composite). */
const folderKey = (groupKey: string, category: FolderCategory) => `${category}\0${groupKey}`;

interface Selection {
  /** Details go through the Agent-level endpoint (not dependent on the sessions table's tracking), so the owning Agent must be carried along. */
  agentId: string;
  sessionId: string;
  /** Server-resolved title of the selected group (the header still prefers a fresher store title). */
  title?: string;
  files: TraceFileRef[];
}

export function TracesPage() {
  useDocumentTitle(S.traces.title);
  const { currentProject, agents, agentsLoading } = useProject();
  const { byAgent } = useSessions();
  const projectId = currentProject?.projectId ?? null;
  const tree = useTraceTree(projectId);
  // ?agentId= deep link (from the Agents page's "traces" entry point): forces agent
  // grouping for this visit (the target must be a visible, expanded group) WITHOUT
  // overwriting the stored preference; only the target Agent defaults to expanded.
  const [searchParams] = useSearchParams();
  const focusAgentId = searchParams.get("agentId");
  // ?sessionId= deep link (jumped to directly from the evaluation center's
  // runs): auto-selects once the target Agent's Session list is ready.
  const focusSessionId = searchParams.get("sessionId");
  // Grouping mode: the same persisted preference as the chat sidebar
  // (penguin.sidebarGroupMode) so the two surfaces always group alike.
  const [modePref, setModePref] = useState<GroupMode>(initialGroupMode);
  const groupMode: GroupMode = focusAgentId !== null ? "agent" : modePref;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fileIndex, setFileIndex] = useState<number | null>(null);
  /** Rendered groups cap (the sidebar's group paging pattern: raised a page per "more groups" click; reset per Project and on a mode switch). */
  const [groupCap, setGroupCap] = useState(TRACES_GROUP_PAGE_SIZE);
  /** Per-group display cap for active rows (keyed by group key; absent = TRACES_PAGE_SIZE). "More" raises it a page at a time. */
  const [groupCaps, setGroupCaps] = useState<ReadonlyMap<string, number>>(new Map());
  /**
   * Agent-mode open groups; null = the default (only the deep-link target / first
   * Agent expands — expanding all of them fanned out one directory scan per Agent).
   * Materialized on the first manual toggle.
   */
  const [openAgentGroups, setOpenAgentGroups] = useState<ReadonlySet<string> | null>(null);
  /** Workspace-mode collapsed groups (expanded by default, like the sidebar — their data is already pooled). */
  const [collapsedWsGroups, setCollapsedWsGroups] = useState<ReadonlySet<string>>(new Set());
  /** Expanded folders (subagent / scheduled / archived; collapsed by default), keyed by folderKey — each folder has its own open state. */
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(new Set());
  /** "More" rows with a fetch in flight, keyed `${category}\0${groupKey}` (disable + loading text). */
  const [pendingLoads, setPendingLoads] = useState<ReadonlySet<string>>(new Set());
  /** Agent whose Trace import is in flight (its header button disables). */
  const [importingAgent, setImportingAgent] = useState<string | null>(null);
  /** File-pill overflow expanded for the current selection. */
  const [showAllFiles, setShowAllFiles] = useState(false);
  // Linked highlighting between the trace observation view and the event list (keyed by tool_call_id).
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);
  /** Session to auto-select once the refreshed list arrives (the import response's sessionId). */
  const importedSession = useRef<{ agentId: string; sessionId: string } | null>(null);

  const setGroupMode = (mode: GroupMode) => {
    storeGroupMode(mode);
    setModePref(mode);
    // The two modes have unrelated group lists: restart the reveal window.
    setGroupCap(TRACES_GROUP_PAGE_SIZE);
  };

  // Clear the selection and per-Project view state when switching Project.
  useEffect(() => {
    setSelection(null);
    setFileIndex(null);
    setGroupCap(TRACES_GROUP_PAGE_SIZE);
    setGroupCaps(new Map());
    setOpenAgentGroups(null);
    setCollapsedWsGroups(new Set());
    setOpenFolders(new Set());
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
   * store first). Memoized Map: a per-row `.find` would re-scan the store list on
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

  /** agentId → display name (row hint tooltips in workspace mode). */
  const agentNameById = useMemo(
    () => new Map(agents.map((a) => [a.agentId, agentDisplayName(a)])),
    [agents],
  );

  // The ?agentId= focus target is pinned first so the deep link stays visible above the
  // group cap (the sidebar's pinnedFirst, with the deep link as the pinned set).
  const orderedAgents = useMemo(
    () =>
      pinnedFirst(agents, (a) => a.agentId, new Set(focusAgentId === null ? [] : [focusAgentId])),
    [agents, focusAgentId],
  );

  /** Agent-mode effective open set: the deep-link target / first Agent until the user toggles. */
  const effectiveOpenAgents = useMemo(() => {
    if (openAgentGroups !== null) return openAgentGroups;
    const first = focusAgentId ?? orderedAgents[0]?.agentId;
    return new Set(first === undefined ? [] : [first]);
  }, [openAgentGroups, focusAgentId, orderedAgents]);

  const toggleAgentGroup = (agentId: string) => {
    const next = new Set(effectiveOpenAgents);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    setOpenAgentGroups(next);
  };

  const toggleWsGroup = (key: string) => {
    setCollapsedWsGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Agent mode loads lazily: only rendered-and-expanded groups fetch their first page.
  const ensureFirstFor = tree.ensureFirstFor;
  useEffect(() => {
    if (!projectId || groupMode !== "agent") return;
    const visible = orderedAgents
      .slice(0, groupCap)
      .map((a) => a.agentId)
      .filter((id) => effectiveOpenAgents.has(id));
    if (visible.length > 0) ensureFirstFor(visible);
  }, [projectId, groupMode, orderedAgents, groupCap, effectiveOpenAgents, ensureFirstFor]);

  // Workspace mode needs every Agent's first active page to group by Workspace at all:
  // fetched in parallel (one paged request per Agent), like the sidebar's reload fans
  // out over the sessions API.
  useEffect(() => {
    if (!projectId || groupMode !== "workspace" || agents.length === 0) return;
    ensureFirstFor(agents.map((a) => a.agentId));
  }, [projectId, groupMode, agents, ensureFirstFor]);

  /** Workspace groups from the pooled rows; the sessionId doubles as the chronological sort key groupSessionsByWorkspace needs (ids embed the creation timestamp). */
  const workspaceGroups = useMemo(
    () => groupSessionsByWorkspace(tree.allRows.map((r) => ({ ...r, createdAt: r.sessionId }))),
    [tree.allRows],
  );
  /** Workspace-mode per-group exact server totals (folded from the per-Agent per-Workspace counts). */
  const workspaceGroupCounts = useMemo(
    () => aggregateWorkspaceCounts(tree.workspaceCountsByAgent),
    [tree.workspaceCountsByAgent],
  );

  const select = useCallback((row: TraceSessionRow) => {
    setSelection({
      agentId: row.agentId,
      sessionId: row.sessionId,
      ...(row.title !== undefined ? { title: row.title } : {}),
      files: row.files,
    });
    setFileIndex(row.files[0]?.index ?? null);
  }, []);

  /**
   * Selects a Session that isn't in the loaded pages (a deep link to, or re-import of,
   * an old Session): one legacy full fetch resolves its files. That is the pre-paging
   * cost of the whole tree, but for a single Agent and only on this path; a miss stays
   * silent, like an in-list miss.
   */
  const selectFromFull = useCallback(
    (agentId: string, sessionId: string) => {
      if (!projectId) return;
      api
        .getAgentTraces(projectId, agentId)
        .then((data) => {
          const target = toSessionGroups(data).find((g) => g.sessionId === sessionId);
          if (target) select({ ...target, agentId });
        })
        .catch(() => {});
    },
    [projectId, select],
  );

  // The Session deep link is applied only once: it selects the target as soon as the
  // target Agent's first page is ready (falling back to a full fetch when the target
  // sorts beyond it or lives in a folder category); after that, the user's manual
  // switches are never pulled back by the deep-link parameter.
  const focusApplied = useRef(false);
  useEffect(() => {
    if (focusApplied.current || !focusSessionId || !focusAgentId) return;
    if (!tree.isLoadedFor(focusAgentId, "active")) return;
    focusApplied.current = true;
    const target = tree.rowsByAgent.get(focusAgentId)?.find((g) => g.sessionId === focusSessionId);
    if (target) select(target);
    else selectFromFull(focusAgentId, focusSessionId);
  }, [tree, focusSessionId, focusAgentId, select, selectFromFull]);

  // Post-import selection: once the refreshed list is in, select the imported Session —
  // an import always creates a new Session whose only file is the imported one, so the
  // default file pick is the imported file. A re-imported OLD session id can sort beyond
  // the refreshed first page; the full-fetch fallback still selects it.
  useEffect(() => {
    const pendingImport = importedSession.current;
    if (pendingImport === null) return;
    const rows = tree.rowsByAgent.get(pendingImport.agentId);
    if (rows === undefined) return;
    importedSession.current = null;
    const target = rows.find((g) => g.sessionId === pendingImport.sessionId);
    if (target) select(target);
    else selectFromFull(pendingImport.agentId, pendingImport.sessionId);
  }, [tree, select, selectFromFull]);

  const runImport = async (agentId: string, dataBase64: string) => {
    if (!projectId) return;
    setImportingAgent(agentId);
    try {
      const res = await api.importAgentTrace(projectId, agentId, { dataBase64 });
      // Refresh the Agent's pages; the effect watching the tree then jumps to the
      // imported Session. The group also expands so the selection is visible.
      importedSession.current = { agentId, sessionId: res.sessionId };
      if (!effectiveOpenAgents.has(agentId)) toggleAgentGroup(agentId);
      await tree.refreshAgent(agentId);
    } catch (e: unknown) {
      // Transient action failure → toast (the app's one notification rule; a
      // rejected import isn't a state of the tree, unlike the inline load error).
      toastError(apiErrorText(e));
    } finally {
      setImportingAgent(null);
    }
  };

  const onPickFile = (agentId: string) => (e: ChangeEvent<HTMLInputElement>) => {
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
      void runImport(agentId, url.slice(url.indexOf(",") + 1)); // strip the data:...;base64, prefix
    };
    reader.onerror = () => toastError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  /** In-flight key of one group's category "More" (folderKey shares the same composite for folder categories). */
  const loadKey = (groupKey: string, category: SessionCategory) => `${category}\0${groupKey}`;

  /** loadMoreFor with an in-flight marker for the triggering "More" row (disable + loading text). */
  const trackedLoadMore = (groupKey: string, category: SessionCategory, agentIds: string[]) => {
    const key = loadKey(groupKey, category);
    setPendingLoads((prev) => new Set(prev).add(key));
    void tree.loadMoreFor(agentIds, category).finally(() => {
      setPendingLoads((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    });
  };

  /**
   * Open/close a group's folder. A folder's content is loaded on demand: the first
   * expand fetches its category's first page for every contributing Agent that hasn't
   * been asked yet (already-loaded rows stay put — re-expanding never refetches; the
   * folder's own "More" row does the paging from there).
   */
  const toggleFolder = (groupKey: string, category: FolderCategory, agentIds: string[]) => {
    const key = folderKey(groupKey, category);
    const opening = !openFolders.has(key);
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (opening) next.add(key);
      else next.delete(key);
      return next;
    });
    if (opening) {
      const unloaded = agentIds.filter((id) => !tree.isLoadedFor(id, category));
      if (unloaded.length > 0) void tree.loadMoreFor(unloaded, category);
    }
  };

  /** Session rows shared by both modes; withAgentHint adds a small Agent avatar per row (workspace mode, where the group no longer names the Agent). */
  const renderRows = (rows: TraceSessionRow[], withAgentHint: boolean) => (
    <ul className="space-y-0.5">
      {rows.map((r) => {
        const active = selection?.sessionId === r.sessionId;
        const hint = agentNameById.get(r.agentId) ?? r.agentId;
        return (
          <li key={r.sessionId}>
            <button
              type="button"
              onClick={() => select(r)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 ${
                active
                  ? "bg-gray-200/70 dark:bg-gray-800"
                  : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
              }`}
            >
              {withAgentHint && (
                <span title={hint} className="flex shrink-0 items-center">
                  <AgentAvatar id={r.agentId} name={hint} size={14} className="rounded" />
                  <span className="sr-only">{hint}</span>
                </span>
              )}
              <Truncated
                text={titleOf(r.sessionId, r.title)}
                className={`min-w-0 flex-1 text-sm ${
                  active
                    ? "font-medium text-gray-900 dark:text-gray-100"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              />
              <span className="shrink-0 font-mono text-[11px] text-gray-400">{r.files.length}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  /**
   * Lazy folder inside a group (the sidebar's renderFolder shape): exists only while
   * the group's own exact server share is non-zero, the label shows that share, and
   * "More" shows only while loaded rows fall short of it.
   */
  const renderFolder = (
    groupKey: string,
    category: FolderCategory,
    parts: Record<SessionCategory, TraceSessionRow[]>,
    withAgentHint: boolean,
    agentIds: string[],
    totals: SessionCategoryCounts | undefined,
  ) => {
    const rows = parts[category];
    // Loaded rows win a disagreement with the totals (counts refresh on the next fetch).
    const total = Math.max(totals?.[category] ?? 0, rows.length);
    if (total === 0) return null;
    const more = rows.length < total && agentIds.some((id) => tree.hasMoreFor(id, category));
    return (
      <FolderSection
        key={category}
        label={S.chat.folderGroups[category](total)}
        open={openFolders.has(folderKey(groupKey, category))}
        onToggle={() => toggleFolder(groupKey, category, agentIds)}
        more={more}
        pending={pendingLoads.has(loadKey(groupKey, category))}
        onMore={() => trackedLoadMore(groupKey, category, agentIds)}
      >
        {renderRows(rows, withAgentHint)}
      </FolderSection>
    );
  };

  /** Active-list "More": reveal one more page of already-loaded active rows AND fetch the next active server page for every Agent that still has one. */
  const showMore = (groupKey: string, agentIds: string[]) => {
    setGroupCaps((prev) => {
      const next = new Map(prev);
      next.set(groupKey, (prev.get(groupKey) ?? TRACES_PAGE_SIZE) + TRACES_PAGE_SIZE);
      return next;
    });
    if (agentIds.length > 0) trackedLoadMore(groupKey, "active", agentIds);
  };

  /**
   * Expanded group body shared by both modes (the sidebar's renderGroupBody shape):
   * active rows (display-capped; "More" reveals and loads further active-only pages —
   * the folders below never feed it) + the collapsed-by-default subagent / scheduled /
   * archived folders, each loading on first expand and paging on its own. Rows are
   * partitioned by their server-classified category (partitionTraceRows).
   */
  const renderGroupBody = (
    groupKey: string,
    rows: TraceSessionRow[],
    withAgentHint: boolean,
    totals: SessionCategoryCounts | undefined,
    agentsFor: (category: SessionCategory) => string[],
    emptyText: string,
  ) => {
    const parts = partitionTraceRows(rows);
    const cap = groupCaps.get(groupKey) ?? TRACES_PAGE_SIZE;
    const shownActive = parts.active.slice(0, cap);
    const activeAgents = agentsFor("active");
    const activeTotal = Math.max(totals?.active ?? 0, parts.active.length);
    const hasMore =
      parts.active.length > cap ||
      (parts.active.length < activeTotal &&
        activeAgents.some((id) => tree.hasMoreFor(id, "active")));
    const folders = FOLDER_CATEGORIES.map((category) =>
      renderFolder(groupKey, category, parts, withAgentHint, agentsFor(category), totals),
    );
    const empty = parts.active.length === 0 && folders.every((f) => f === null);
    const activePending = pendingLoads.has(loadKey(groupKey, "active"));
    return (
      <>
        {empty ? (
          <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">{emptyText}</p>
        ) : (
          renderRows(shownActive, withAgentHint)
        )}
        {/* Load/reveal more (kept adjacent to the active list it extends, above the folders) */}
        {hasMore && (
          <MoreRow
            label={S.chat.loadMore}
            pending={activePending}
            onClick={() => showMore(groupKey, activeAgents)}
            className="mt-0.5"
          />
        )}
        {folders}
      </>
    );
  };

  /** Owner-only Trace import control (the Agent group header's trailing action). */
  const importAction = (agentId: string): ReactNode => {
    if (currentProject?.role !== "owner") return undefined;
    const importing = importingAgent === agentId;
    return (
      <label
        title={importing ? S.traces.importing : S.traces.importTrace}
        className={`shrink-0 cursor-pointer rounded p-1 text-gray-400 transition-colors duration-150 hover:bg-gray-200/50 hover:text-gray-600 dark:hover:bg-gray-800/50 dark:hover:text-gray-300 ${
          importing ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <HiddenFileInput accept=".jsonl" disabled={importing} onChange={onPickFile(agentId)} />
        <UploadIcon size={13} />
        <span className="sr-only">{importing ? S.traces.importing : S.traces.importTrace}</span>
      </label>
    );
  };

  if (!projectId) return null;

  const activeFile =
    selection === null
      ? null
      : (selection.files.find((f) => f.index === fileIndex) ?? selection.files[0] ?? null);
  const visibleFiles =
    selection === null || showAllFiles ? null : selection.files.slice(0, FILE_PILL_CAP);

  /** Workspace mode is still fanning out its first pages and has nothing pooled yet. */
  const wsLoading =
    tree.allRows.length === 0 && agents.some((a) => tree.isPendingFor(a.agentId, "active"));

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Directory tree (≥md left column; <md top collapsible area).
          relative: a scroller is its own containing block — the invariant and the failure it
          prevents are documented in styles.css; this is where it first bit (an Agent node past
          the fold put its import control's absolutely positioned box at a document-level
          offset, growing the document). */}
      <aside className="relative max-h-52 shrink-0 overflow-y-auto border-b border-gray-200 bg-gray-50 px-1 py-2 md:max-h-none md:w-72 md:border-b-0 md:border-r dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between px-3 pb-1">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
            {S.traces.title}
          </p>
          {/* Hidden while an ?agentId= deep link forces agent grouping: a toggle showing
              the (possibly different) stored preference would look broken. */}
          {focusAgentId === null && <GroupModeToggle value={modePref} onChange={setGroupMode} />}
        </div>
        {agentsLoading || (groupMode === "workspace" && wsLoading) ? (
          <SkeletonList rows={4} />
        ) : groupMode === "agent" ? (
          <>
            {orderedAgents.slice(0, groupCap).map((a) => {
              const open = effectiveOpenAgents.has(a.agentId);
              const name = agentDisplayName(a);
              const error = tree.errorByAgent.get(a.agentId);
              const loaded = tree.isLoadedFor(a.agentId, "active");
              return (
                <div key={a.agentId} className="pt-2.5">
                  <GroupHeader
                    open={open}
                    onToggle={() => toggleAgentGroup(a.agentId)}
                    icon={
                      <AgentAvatar
                        id={a.agentId}
                        name={name}
                        size={18}
                        className="shrink-0 rounded"
                      />
                    }
                    label={name}
                    uppercase
                    actions={importAction(a.agentId)}
                  />
                  {open && (
                    <div className="anim-fade">
                      {/* Load failure of the tree itself stays inline (the one-notification-rule keeps load states with their content, not in a disappearing toast). */}
                      {error !== undefined && (
                        <p className="px-2.5 py-1 text-xs text-red-500">{error}</p>
                      )}
                      {!loaded && error === undefined && (
                        <p className="px-2.5 py-1 text-xs text-gray-400">{S.common.loading}</p>
                      )}
                      {loaded &&
                        renderGroupBody(
                          a.agentId,
                          tree.rowsByAgent.get(a.agentId) ?? [],
                          false,
                          tree.countsByAgent.get(a.agentId),
                          () => [a.agentId],
                          S.traces.empty,
                        )}
                    </div>
                  )}
                </div>
              );
            })}
            {orderedAgents.length > groupCap && (
              <MoreRow
                label={S.chat.moreGroups(orderedAgents.length - groupCap)}
                onClick={() => setGroupCap((c) => c + TRACES_GROUP_PAGE_SIZE)}
                className="mt-1"
              />
            )}
          </>
        ) : workspaceGroups.length === 0 ? (
          <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
            {S.chat.noSessions}
          </p>
        ) : (
          <>
            {workspaceGroups.slice(0, groupCap).map((group) => {
              const collapsed = collapsedWsGroups.has(group.key);
              const parts = partitionTraceRows(group.sessions);
              /** This group's exact server share (per-Workspace fold) and its per-category fetch fan-out. */
              const counts = workspaceGroupCounts.get(group.key);
              const contributingAgents = [...new Set(group.sessions.map((s) => s.agentId))];
              const agentsFor = (category: SessionCategory) => [
                ...new Set([...(counts?.agents[category] ?? []), ...contributingAgents]),
              ];
              return (
                <div key={group.key} className="pt-2.5">
                  <GroupHeader
                    open={!collapsed}
                    onToggle={() => toggleWsGroup(group.key)}
                    icon={
                      /* Folder opens and closes with the group */
                      <span className="shrink-0 text-gray-400 dark:text-gray-500">
                        <Icon d={collapsed ? FOLDER_ICON : FOLDER_OPEN_ICON} size={15} />
                      </span>
                    }
                    label={group.temp ? S.chat.tempWorkspaces : group.label}
                    count={Math.max(counts?.totals.active ?? 0, parts.active.length)}
                    {...(group.fullPath !== null ? { title: group.fullPath } : {})}
                  />
                  {/* A workspace group can span Agents: the group body fans folder loads and
                      "More" out per category to the Agents whose share of THIS group is
                      non-zero (plus the Agents already contributing loaded rows). */}
                  {collapsed
                    ? null
                    : renderGroupBody(
                        group.key,
                        group.sessions,
                        true,
                        counts?.totals,
                        agentsFor,
                        S.chat.noSessions,
                      )}
                </div>
              );
            })}
            {workspaceGroups.length > groupCap && (
              <MoreRow
                label={S.chat.moreGroups(workspaceGroups.length - groupCap)}
                onClick={() => setGroupCap((c) => c + TRACES_GROUP_PAGE_SIZE)}
                className="mt-1"
              />
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
