/**
 * Pure Session-list logic for the Trace page (kept out of the components so it is unit
 * testable): mapping either server response shape to the page's Session groups, and
 * partitioning rows by their server-classified category.
 */
import type { AgentTracesResponse, SessionCategory } from "@prismshadow/penguin-server/api";

export interface TraceFileRef {
  index: number;
  date: string;
  sizeBytes: number;
}

export interface TraceSessionGroup {
  sessionId: string;
  /** Server-resolved display title (DB title or first-prompt fallback); absent for legacy responses / untitled Sessions. */
  title?: string;
  /**
   * Server-classified sidebar category (the paged endpoint's bounded classification —
   * the same value its filter and counts used, so rows and buckets can't disagree).
   * Legacy responses carry no classification; the mapper defaults to "active".
   */
  category: SessionCategory;
  /** Workspace path ("" = unknown → the merged temp group, same defensive rule as the sidebar's isTempWorkspace). */
  workspace: string;
  /** Sorted newest first (a higher index is newer) — the page's display order. */
  files: TraceFileRef[];
}

/** A pooled row of the Trace tree: the group plus its owning Agent (the fetch that produced it). */
export interface TraceSessionRow extends TraceSessionGroup {
  agentId: string;
}

/**
 * Maps a listing response to Session groups, newest Session first. A paged response
 * (`sessions` present) is already session-centric and server-ordered; a legacy full
 * response is flattened from its date grouping (merging one Session's files across
 * dates) and sorted by sessionId descending — ids embed a timestamp, so that is
 * reverse chronological, matching the server's paged ordering.
 */
export function toSessionGroups(data: AgentTracesResponse): TraceSessionGroup[] {
  if (data.sessions) {
    return data.sessions.map((s) => ({
      sessionId: s.sessionId,
      ...(s.title !== undefined ? { title: s.title } : {}),
      category: s.category,
      workspace: s.workspace,
      files: [...s.files].sort((a, b) => b.index - a.index),
    }));
  }
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
      category: "active" as const,
      workspace: "",
      files: files.sort((a, b) => b.index - a.index),
    }));
}

/**
 * Partition of one group's rows by their server-classified category — the Trace-side
 * twin of session-grouping's partitionSessions (which derives the category client-side
 * from SessionInfo; here the server field is authoritative, because it is what the
 * per-category fetches and counts were computed from).
 */
export function partitionTraceRows<T extends { category: SessionCategory }>(
  rows: readonly T[],
): Record<SessionCategory, T[]> {
  const parts: Record<SessionCategory, T[]> = {
    active: [],
    subagent: [],
    schedule: [],
    archived: [],
  };
  for (const r of rows) parts[r.category].push(r);
  return parts;
}
