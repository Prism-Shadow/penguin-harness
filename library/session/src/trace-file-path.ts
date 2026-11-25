/**
 * Absolute path of an indexed Trace shard. The rows never store paths (the data root may
 * move), so the trace index and the session service reconstruct the shard's location from the
 * row's identity: the Trace tree's date directory, then the shard file's
 * `sessionId_NNN.jsonl` name — the same convention the trace index parses back with its
 * `TRACE_FILE_RE`. Lives with the session domain (the session service's single-session GET
 * names a Session's latest shard); the trace package re-exports it unchanged.
 */
import path from "node:path";
import { tracesDir } from "@prismshadow/penguin-core";

/** A trace_files index row, narrowed to the fields the path is built from (the trace domain's TraceFileRow satisfies it). */
export type TraceFilePathRow = {
  projectId: string;
  agentId: string;
  sessionId: string;
  fileIndex: number;
  date: string;
};

export function traceFilePath(root: string, row: TraceFilePathRow): string {
  const name = `${row.sessionId}_${String(row.fileIndex).padStart(3, "0")}.jsonl`;
  return path.join(tracesDir(root, row.projectId, row.agentId), row.date, name);
}
