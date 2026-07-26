/**
 * Trace browsing page: the left-side directory lists Sessions grouped only by
 * Agent (titles come from the Sessions context, with unmanaged CLI/subagent
 * Sessions falling back to sessionId); the right side shows the selected
 * Session's Trace files (paged, most recent first by default) + performance
 * analysis (an execution timeline) + an event timeline.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { AgentTracesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatBytes } from "../../lib/format";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Chevron } from "../../components/ui/chevron";
import { Truncated } from "../../components/ui/truncated";
import { useSessions } from "../../state/sessions";
import { EmptyState } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { TraceFileView } from "./trace-file-view";
import type { TraceHighlight } from "./timeline-chart";

interface TraceFileRef {
  index: number;
  date: string;
  sizeBytes: number;
}

interface SessionGroup {
  sessionId: string;
  files: TraceFileRef[];
}

interface Selection {
  /** Details go through the Agent-level endpoint (not dependent on the sessions table's tracking), so the owning Agent must be carried along. */
  agentId: string;
  sessionId: string;
  files: TraceFileRef[];
}

/** Flatten by Session (merging a Session's files across dates); Sessions are sorted by id descending = newest first. */
function flattenSessions(data: AgentTracesResponse): SessionGroup[] {
  const bySession = new Map<string, TraceFileRef[]>();
  for (const d of data.dates) {
    for (const s of d.sessions) {
      const list = bySession.get(s.sessionId) ?? [];
      for (const f of s.files) list.push({ index: f.index, date: d.date, sizeBytes: f.sizeBytes });
      bySession.set(s.sessionId, list);
    }
  }
  return [...bySession.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([sessionId, files]) => ({
      sessionId,
      // Files sorted newest first by default (a higher index is newer).
      files: files.sort((a, b) => b.index - a.index),
    }));
}

/** A single Agent's expandable tree node (traces are fetched only when expanded; titles are mapped via the Sessions context). */
function AgentNode({
  projectId,
  agentId,
  name,
  defaultOpen,
  focusSessionId,
  titleOf,
  selection,
  onSelect,
}: {
  projectId: string;
  agentId: string;
  name: string;
  /** Initial expanded state: all expanded when there's no deep link; only the target Agent expanded when there's an ?agentId= deep link. */
  defaultOpen: boolean;
  /** ?sessionId= deep link (jumped to directly from the evaluation center's runs): auto-selects that Session once the list is ready (only once). */
  focusSessionId?: string;
  titleOf: (agentId: string, sessionId: string) => string | undefined;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [groups, setGroups] = useState<SessionGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || groups) return;
    api
      .getAgentTraces(projectId, agentId)
      .then((data) => setGroups(flattenSessions(data)))
      .catch((e: unknown) => setError(apiErrorText(e)));
  }, [open, groups, projectId, agentId]);

  // The Session deep link is applied only once: it selects the target as
  // soon as the list is first ready (if not found, it just stays in the
  // list state without erroring); after that, the user's manual switches
  // are never pulled back by the deep-link parameter.
  const focusApplied = useRef(false);
  useEffect(() => {
    if (focusApplied.current || !focusSessionId || !groups) return;
    focusApplied.current = true;
    const target = groups.find((g) => g.sessionId === focusSessionId);
    if (target) onSelect({ agentId, sessionId: target.sessionId, files: target.files });
  }, [groups, focusSessionId, agentId, onSelect]);

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
      </div>
      {open && (
        <div className="anim-fade">
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
              const title = titleOf(agentId, g.sessionId);
              return (
                <li key={g.sessionId}>
                  <button
                    type="button"
                    onClick={() => onSelect({ agentId, sessionId: g.sessionId, files: g.files })}
                    className={`flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 ${
                      active
                        ? "bg-gray-200/70 dark:bg-gray-800"
                        : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
                    }`}
                  >
                    <Truncated
                      text={title ?? g.sessionId}
                      className={`min-w-0 flex-1 ${title ? "text-sm" : "font-mono text-xs"} ${
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
  // Linked highlighting between the trace observation view and the event list (keyed by tool_call_id).
  const [highlight, setHighlight] = useState<TraceHighlight | null>(null);

  // Clear the selection when switching Project.
  useEffect(() => {
    setSelection(null);
    setFileIndex(null);
  }, [projectId]);

  // Clear the linked highlight when switching Session / Trace file.
  useEffect(() => {
    setHighlight(null);
  }, [selection, fileIndex]);

  const titleOf = (agentId: string, sessionId: string): string | undefined =>
    byAgent.get(agentId)?.find((s) => s.sessionId === sessionId)?.title;

  if (!projectId) return null;

  const activeFile =
    selection === null
      ? null
      : (selection.files.find((f) => f.index === fileIndex) ?? selection.files[0] ?? null);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Directory tree: Agent → Session title (≥md left column; <md top collapsible area) */}
      <aside className="max-h-52 shrink-0 overflow-y-auto border-b border-gray-200 bg-gray-50 px-1 py-2 md:max-h-none md:w-72 md:border-b-0 md:border-r dark:border-gray-800 dark:bg-gray-900">
        <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-gray-500">
          {S.traces.title}
        </p>
        {agentsLoading ? (
          <SkeletonList rows={4} />
        ) : (
          <ul>
            {agents.map((a) => (
              <AgentNode
                key={a.agentId}
                projectId={projectId}
                agentId={a.agentId}
                name={agentDisplayName(a)}
                defaultOpen={focusAgentId === null || focusAgentId === a.agentId}
                {...(focusSessionId !== null && focusAgentId === a.agentId
                  ? { focusSessionId }
                  : {})}
                titleOf={titleOf}
                selection={selection}
                onSelect={(sel) => {
                  setSelection(sel);
                  setFileIndex(sel.files[0]?.index ?? null);
                }}
              />
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto p-3 md:p-4">
        {selection && activeFile ? (
          <div className="mx-auto max-w-4xl space-y-4">
            {/* Header: Session title + Trace file pagination (newest first) */}
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                {titleOf(selection.agentId, selection.sessionId) ?? (
                  <span className="font-mono text-xs font-normal text-gray-500">
                    {selection.sessionId}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-xs text-gray-400">{S.traces.filesTitle}</span>
                {selection.files.map((f) => (
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
              </div>
            </div>
            <p className="truncate font-mono text-xs text-gray-400">
              {selection.sessionId} · {activeFile.date} · {formatBytes(activeFile.sizeBytes)}
            </p>

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
