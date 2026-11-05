/**
 * Which Sessions an Agent archive export carries, and the facts it records for each.
 *
 * The selection is made over the Trace index after a reconcile, so a Session a CLI run left
 * behind and nobody adopted counts too, joined with the sessions table for what only it knows
 * (title, dates, archived/kept marks, approval mode). A Session travels whole: every `_NNN`
 * file, then its subagent children that live under the same Agent, recursively. `last:N` takes
 * the N most recently active top-level Sessions (a subagent child is never one at the top);
 * `range` takes the top-level Sessions whose date directory lies in the range. A Session one of
 * whose files is larger than an import accepts is left out and reported.
 */
import fs from "node:fs/promises";
import type { ArchivedSessionFacts, TraceSelection } from "../api/types.js";
import type { TraceFileRow, TraceSessionRow } from "../db/repos/trace-index.js";
import type { SessionRow } from "../db/repos/sessions.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { TraceIndex, TraceIndexStore, Traces } from "../mechanisms/traces.js";
import { sessionIdCreatedAt } from "../services/session-service.js";
import { traceFilePath } from "../services/trace-index.js";
import { MAX_ENTRY_BYTES } from "./limits.js";

export interface TraceSelectionDeps {
  root: string;
  now: () => Date;
  traceIndex: TraceIndex;
  traceStore: TraceIndexStore;
  traces: Pick<Traces, "subagentChildren">;
  sessionsRepo: Pick<SessionIndex, "listByAgent">;
}

/** One selected Session: the facts `traces/sessions.json` records and its files as they are now. */
export interface SelectedSession {
  facts: ArchivedSessionFacts;
  files: Array<{ index: number; date: string; path: string; size: number }>;
}

export interface SelectedSessions {
  sessions: SelectedSession[];
  skipped: Array<{ sessionId: string; reason: "too_large" }>;
}

/** The order `last:N` reads: most recently active first, the id breaking ties. */
function activityKey(trace: TraceSessionRow, row: SessionRow | undefined): string {
  return row?.lastActiveAt ?? trace.firstTs ?? "";
}

function factsOf(
  sessionId: string,
  trace: TraceSessionRow | undefined,
  row: SessionRow | undefined,
  files: number,
  now: Date,
  parentSessionId?: string,
): ArchivedSessionFacts {
  const createdAt =
    row?.createdAt ?? sessionIdCreatedAt(sessionId) ?? trace?.firstTs ?? now.toISOString();
  return {
    sessionId,
    files,
    createdAt,
    lastActiveAt: row?.lastActiveAt ?? createdAt,
    title: row?.title ?? trace?.title ?? null,
    archivedAt: row?.archivedAt ?? null,
    keptAt: row?.keptAt ?? null,
    approvalMode: row?.approvalMode ?? "allow-all",
    thinkingLevel: row?.thinkingLevel ?? null,
    // No row: a Session a CLI run wrote and this server never adopted.
    client: row === undefined ? "cli" : (row.client ?? "web"),
    workspace: row?.workspace ?? trace?.workspace ?? "",
    provider: row?.provider ?? trace?.provider ?? "",
    modelId: row?.modelId ?? trace?.modelId ?? "",
    ...(parentSessionId !== undefined ? { parentSessionId } : {}),
  };
}

export async function selectSessions(
  deps: TraceSelectionDeps,
  projectId: string,
  agentId: string,
  selection: TraceSelection,
): Promise<SelectedSessions> {
  const out: SelectedSessions = { sessions: [], skipped: [] };
  if (selection.kind === "none") return out;
  await deps.traceIndex.reconcileAgent(projectId, agentId, { force: true });
  const traces = new Map(
    deps.traceStore.listSessionsByAgent(projectId, agentId).map((t) => [t.sessionId, t]),
  );
  const filesOf = new Map<string, TraceFileRow[]>();
  for (const file of deps.traceStore.listFilesByAgent(projectId, agentId)) {
    const list = filesOf.get(file.sessionId) ?? [];
    list.push(file);
    filesOf.set(file.sessionId, list);
  }
  const rows = new Map(
    deps.sessionsRepo.listByAgent(projectId, agentId).map((r) => [r.sessionId, r]),
  );

  const topLevel = [...filesOf.keys()]
    .filter((sessionId) => traces.get(sessionId)?.source !== "subagent")
    .map((sessionId) => {
      const files = filesOf.get(sessionId)!;
      const earliest = files.reduce((a, b) => (b.fileIndex < a.fileIndex ? b : a));
      const trace = traces.get(sessionId);
      return {
        sessionId,
        date: earliest.date,
        key: trace !== undefined ? activityKey(trace, rows.get(sessionId)) : "",
      };
    })
    .sort((a, b) =>
      a.key === b.key ? b.sessionId.localeCompare(a.sessionId) : a.key < b.key ? 1 : -1,
    );
  const chosen =
    selection.kind === "last"
      ? topLevel.slice(0, selection.count)
      : topLevel.filter((s) => s.date >= selection.from && s.date <= selection.to);

  const seen = new Set<string>();
  const now = deps.now();
  const add = async (sessionId: string, parentSessionId?: string): Promise<void> => {
    if (seen.has(sessionId)) return;
    seen.add(sessionId);
    const rowsOfFiles = [...(filesOf.get(sessionId) ?? [])].sort(
      (a, b) => a.fileIndex - b.fileIndex,
    );
    const files: SelectedSession["files"] = [];
    for (const file of rowsOfFiles) {
      const filePath = traceFilePath(deps.root, file);
      // Sizes are read now, not from the index: an in-place append moves no directory mtime.
      const size = await fs.stat(filePath).then(
        (stat) => stat.size,
        () => null,
      );
      if (size !== null)
        files.push({ index: file.fileIndex, date: file.date, path: filePath, size });
    }
    if (files.length === 0) return;
    if (files.some((file) => file.size > MAX_ENTRY_BYTES)) {
      out.skipped.push({ sessionId, reason: "too_large" });
      return;
    }
    out.sessions.push({
      facts: factsOf(
        sessionId,
        traces.get(sessionId),
        rows.get(sessionId),
        files.length,
        now,
        parentSessionId,
      ),
      files,
    });
    const children = await deps.traces.subagentChildren(projectId, agentId, sessionId);
    for (const child of children) {
      if (child.agentId === agentId) await add(child.sessionId, sessionId);
    }
  };
  for (const session of chosen) await add(session.sessionId);
  return out;
}
