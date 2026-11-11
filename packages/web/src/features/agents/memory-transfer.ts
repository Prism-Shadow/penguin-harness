/**
 * Whole-scope transfer for the Memory tab: reading a downloaded document back in, and working
 * out what one import mode would cost before it is sent. Pure — mirrors memory-chat-prompts.ts,
 * exported for unit tests.
 *
 * The plan below is a preview, not the decision: the server runs the same policy over the
 * directory as it is at that moment, and refuses a destructive import that arrives without
 * confirmation. What this buys is a confirmation that can name the memories at stake instead of
 * asking the user to agree to an unknown.
 *
 * Read `S` inside the functions, never at module top level: the dictionary binding is swapped
 * on language switch.
 */
import type {
  MemoryImportMode,
  MemoryScopeDocument,
  MemoryScopeExport,
  MemoryScopeExportV1,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

/** Format marker of a scope document, typed against the DTO so this literal cannot drift from the server's. */
const SCOPE_FORMAT: MemoryScopeDocument["format"] = "penguin-memory-scope";
/** The version the server writes: a topic may carry the files its folder keeps. */
const SCOPE_FORMAT_VERSION: MemoryScopeExport["version"] = 2;
/**
 * The version from before a topic kept files; the server still imports it. Retired with the
 * server's reader at 1.0 (server services/memory-transfer-document.ts says what goes).
 */
const SCOPE_FORMAT_VERSION_TOPICS_ONLY: MemoryScopeExportV1["version"] = 1;

/** A picked file that is not a scope document. Its message is already localized, so callers toast it as is. */
export class MemoryDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryDocumentError";
  }
}

function isTransferFile(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.name === "string" && typeof entry.content === "string";
}

/**
 * Reads a picked file's text as a scope document, of either version the server imports. Only the
 * shape is checked here — names, paths, sizes and counts are the server's to enforce, and a second
 * copy of those bounds would only drift.
 */
export function parseMemoryScopeDocument(text: string): MemoryScopeDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MemoryDocumentError(S.memory.importInvalidFile);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MemoryDocumentError(S.memory.importInvalidFile);
  }
  const doc = parsed as Record<string, unknown>;
  if (
    doc.format !== SCOPE_FORMAT ||
    (doc.version !== SCOPE_FORMAT_VERSION && doc.version !== SCOPE_FORMAT_VERSION_TOPICS_ONLY)
  ) {
    throw new MemoryDocumentError(S.memory.importInvalidFile);
  }
  if (!Array.isArray(doc.files) || !doc.files.every(isTransferFile)) {
    throw new MemoryDocumentError(S.memory.importInvalidFile);
  }
  if (doc.files.length === 0 && typeof doc.index !== "string") {
    throw new MemoryDocumentError(S.memory.importEmptyFile);
  }
  return doc as unknown as MemoryScopeDocument;
}

/** What the scope holds right now, as the tab already knows it. */
export interface MemoryScopeState {
  /** Topic file names listed in the group. */
  names: readonly string[];
  /** Folders in the group that no topic keeps (`leftover` for `leftover/old.py`). */
  orphanFolders: readonly string[];
  /** Whether the scope has a `MEMORY.md` index. */
  hasIndex: boolean;
}

/** The folder a topic keeps its files in: its file name without the `.md`. */
const folderOf = (name: string): string => name.slice(0, -".md".length);

/**
 * What one import mode would do to that scope, memory by memory. A memory moves with its folder,
 * and a folder no topic keeps counts as its topic being there (the server's rule); `removed`
 * names such a folder as `<folder>/`.
 */
export interface MemoryImportPlan {
  /** Memories the scope does not have yet. */
  added: string[];
  /** Memories whose content the file would replace. */
  overwritten: string[];
  /** Memories left as they are, because the scope already has that name. */
  skipped: string[];
  /** Memories deleted, because the file does not carry them. */
  removed: string[];
  /** Whether the scope's existing index would be replaced wholesale. */
  replacesIndex: boolean;
  /** Whether anything would be lost — the one question the confirmation exists to ask. */
  destroys: boolean;
}

export function planMemoryImport(
  doc: MemoryScopeDocument,
  scope: MemoryScopeState,
  mode: MemoryImportMode,
): MemoryImportPlan {
  const names = doc.files.map((f) => f.name);
  const strays = new Set(scope.orphanFolders);
  const present = new Set(scope.names);
  const isPresent = (name: string): boolean => present.has(name) || strays.has(folderOf(name));
  const carried = new Set(names);
  const carriedFolders = new Set(names.map(folderOf));
  const collides = names.filter(isPresent);
  const added = names.filter((name) => !isPresent(name));
  const overwritten = mode === "skip" ? [] : collides;
  const skipped = mode === "skip" ? collides : [];
  const removed =
    mode === "replace"
      ? [
          ...scope.names.filter((name) => !carried.has(name)),
          ...scope.orphanFolders.filter((f) => !carriedFolders.has(f)).map((f) => `${f}/`),
        ]
      : [];
  const replacesIndex = mode === "replace" && scope.hasIndex && doc.index !== null;
  return {
    added,
    overwritten,
    skipped,
    removed,
    replacesIndex,
    destroys: overwritten.length > 0 || removed.length > 0 || replacesIndex,
  };
}

/** `YYYYMMDD-HHmm` in the viewer's local time, or null when the ISO string is unreadable. */
function fileNameStamp(exportedAt: string): string | null {
  const d = new Date(exportedAt);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * File name of a downloaded scope document: Agent, scope, and the document's own `exportedAt`
 * rendered in the viewer's local time, so repeated exports of one scope stay apart in a
 * downloads folder. Same `<agent>-<scope>-memory-<stamp>.json` pattern as the export route's
 * Content-Disposition, whose stamp renders on the server's clock instead.
 */
export function memoryDocumentFileName(
  agentId: string,
  scopeKey: string,
  exportedAt: string,
): string {
  const stamp = fileNameStamp(exportedAt);
  return stamp === null
    ? `${agentId}-${scopeKey}-memory.json`
    : `${agentId}-${scopeKey}-memory-${stamp}.json`;
}
