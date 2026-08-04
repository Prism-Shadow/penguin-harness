/**
 * Pure Session-list logic for the Trace page (kept out of the component so it is unit
 * testable): mapping either server response shape to the page's Session groups, and
 * appending a fetched page onto the loaded list.
 */
import type { AgentTracesResponse } from "@prismshadow/penguin-server/api";

export interface TraceFileRef {
  index: number;
  date: string;
  sizeBytes: number;
}

export interface TraceSessionGroup {
  sessionId: string;
  /** Server-resolved display title (DB title or first-prompt fallback); absent for legacy responses / untitled Sessions. */
  title?: string;
  /** Sorted newest first (a higher index is newer) — the page's display order. */
  files: TraceFileRef[];
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
      files: files.sort((a, b) => b.index - a.index),
    }));
}

/**
 * Appends a fetched page onto the loaded list, deduplicating by sessionId (a Session
 * created between two fetches shifts the server's offsets, so a page can re-serve an
 * already-loaded group — the loaded copy wins, keeping list positions stable).
 */
export function appendSessionGroups(
  loaded: readonly TraceSessionGroup[],
  fetched: readonly TraceSessionGroup[],
): TraceSessionGroup[] {
  const seen = new Set(loaded.map((g) => g.sessionId));
  return [...loaded, ...fetched.filter((g) => !seen.has(g.sessionId))];
}
