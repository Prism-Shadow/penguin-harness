/**
 * Memory-change rows for the Task summary card and the side panel's memory view: classifies
 * structured file-tool writes (`write_file` / `edit_file`) against the Session's Memory root
 * (`<agent_state>/memory/`, see core's state/memory.ts for the on-disk layout) and merges
 * repeated changes of one topic file into a single row — the minimal record the displays
 * need: which file, in which scope, what kind of change, and when it last happened.
 *
 * Like the file-summary card, this only sees the structured signal: memory files touched
 * through an opaque `exec_command` shell (including deletions — no builtin delete tool
 * exists) are invisible here, so the rows are a summary of tool-recorded changes, not an
 * audit trail.
 */

/** How a memory file was changed: `write` = full-content write (write_file, which also creates), `edit` = in-place edit (edit_file). */
export type MemoryChangeOp = "write" | "edit";

/** One merged row: a memory topic file that was changed. */
export interface MemoryChangeRow {
  /** Memory scope the file belongs to: the Agent-wide User scope or one Workspace scope. */
  scope: "user" | "workspace";
  /** The Workspace scope's directory key (`memory/<key>/`); absent for the User scope. */
  scopeKey?: string;
  /** Path relative to the scope directory (usually `<topic>.md`). */
  file: string;
  /** Merged summary op: `write` when any call wrote the whole file, else `edit`. */
  op: MemoryChangeOp;
  /** Execution start (message time) of the file's latest qualifying call. */
  atMs?: number;
}

/** A classified memory path (no op yet — the caller derives that from the tool name). */
export type MemoryPathClass = Omit<MemoryChangeRow, "op" | "atMs">;

/** A single change before merging. */
export type MemoryChangeEntry = MemoryPathClass & { op: MemoryChangeOp; atMs?: number };

/** Row identity used by "locate this row in the memory view" requests. */
export interface MemoryLocateTarget {
  scope: "user" | "workspace";
  scopeKey?: string;
  file: string;
}

/** The locate key of a row or target: one file within one scope. */
export function memoryRowKey(row: MemoryLocateTarget): string {
  return `${row.scope} ${row.scopeKey ?? ""} ${row.file}`;
}

/** Splits an absolute path into non-empty segments, tolerating either separator (server paths may be Windows-style). */
function segments(p: string): string[] {
  return p.split(/[\\/]/).filter((s) => s.length > 0);
}

/**
 * Classifies one file-tool path against the Memory root. Returns null when the path is not a
 * display-worthy memory change: outside `<agent_state>/memory/`, the scope directory itself,
 * a scope's `MEMORY.md` index (rewritten alongside almost every topic change — listing it
 * would double every row), or the `.workspace` marker file.
 */
export function classifyMemoryPath(filePath: string, agentState: string): MemoryPathClass | null {
  const root = [...segments(agentState), "memory"];
  const parts = segments(filePath);
  if (parts.length <= root.length + 1) return null; // too short for <root>/memory/<scope>/<file>
  for (let i = 0; i < root.length; i++) {
    if (parts[i] !== root[i]) return null;
  }
  const scopeSeg = parts[root.length]!;
  const file = parts.slice(root.length + 1).join("/");
  if (file === "MEMORY.md" || file === ".workspace") return null;
  return scopeSeg === "user"
    ? { scope: "user", file }
    : { scope: "workspace", scopeKey: scopeSeg, file };
}

/**
 * Content equality of two aggregated row lists. The chat page re-derives rows from the
 * stream on every streamed message; consumers key effects (listing refetch, detail refetch)
 * and memos on the rows' identity, so the page keeps the previous array whenever this says
 * nothing actually changed — a streaming tick must not re-fire those effects.
 */
export function sameMemoryChanges(
  a: readonly MemoryChangeRow[],
  b: readonly MemoryChangeRow[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i]!;
    const rb = b[i]!;
    if (
      ra.scope !== rb.scope ||
      ra.scopeKey !== rb.scopeKey ||
      ra.file !== rb.file ||
      ra.op !== rb.op ||
      ra.atMs !== rb.atMs
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Merges the Task's classified changes into one row per file, preserving first-seen order.
 * A `write` dominates regardless of order — "wrote the file, then tweaked it" still
 * summarizes as a write, and "edited, then rewrote" even more so; `atMs` follows the
 * latest call.
 */
export function mergeMemoryChanges(entries: readonly MemoryChangeEntry[]): MemoryChangeRow[] {
  const rows = new Map<string, MemoryChangeRow>();
  for (const e of entries) {
    const k = memoryRowKey(e);
    const prev = rows.get(k);
    if (prev === undefined) {
      const row: MemoryChangeRow = { scope: e.scope, file: e.file, op: e.op };
      if (e.scopeKey !== undefined) row.scopeKey = e.scopeKey;
      if (e.atMs !== undefined) row.atMs = e.atMs;
      rows.set(k, row);
    } else {
      if (e.op === "write") prev.op = "write";
      if (e.atMs !== undefined) prev.atMs = e.atMs;
    }
  }
  return [...rows.values()];
}

/**
 * Merges several Tasks' row lists (in Task order) into one per-file list for the side
 * panel: the summary op stays write-dominant, `atMs` follows the latest Task's, order is
 * first appearance across the whole session.
 */
export function aggregateMemoryChanges(
  rowLists: readonly (readonly MemoryChangeRow[])[],
): MemoryChangeRow[] {
  const entries: MemoryChangeEntry[] = [];
  for (const rows of rowLists) {
    for (const row of rows) {
      const entry: MemoryChangeEntry = { scope: row.scope, file: row.file, op: row.op };
      if (row.scopeKey !== undefined) entry.scopeKey = row.scopeKey;
      if (row.atMs !== undefined) entry.atMs = row.atMs;
      entries.push(entry);
    }
  }
  return mergeMemoryChanges(entries);
}
