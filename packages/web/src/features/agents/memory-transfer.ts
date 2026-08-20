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
  MemoryScopeExport,
  MemoryTransferFile,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

/** Format marker of a scope document, typed against the DTO so this literal cannot drift from the server's. */
const SCOPE_FORMAT: MemoryScopeExport["format"] = "penguin-memory-scope";
const SCOPE_FORMAT_VERSION: MemoryScopeExport["version"] = 1;

/** A picked file that is not a scope document. Its message is already localized, so callers toast it as is. */
export class MemoryDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryDocumentError";
  }
}

function isTransferFile(value: unknown): value is MemoryTransferFile {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.name === "string" && typeof entry.content === "string";
}

/**
 * Reads a picked file's text as a scope document. Only the shape is checked here — names, sizes
 * and counts are the server's to enforce, and a second copy of those bounds would only drift.
 */
export function parseMemoryScopeDocument(text: string): MemoryScopeExport {
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
  if (doc.format !== SCOPE_FORMAT || doc.version !== SCOPE_FORMAT_VERSION) {
    throw new MemoryDocumentError(S.memory.importInvalidFile);
  }
  if (!Array.isArray(doc.files) || !doc.files.every(isTransferFile)) {
    throw new MemoryDocumentError(S.memory.importInvalidFile);
  }
  if (doc.files.length === 0 && typeof doc.index !== "string") {
    throw new MemoryDocumentError(S.memory.importEmptyFile);
  }
  return doc as unknown as MemoryScopeExport;
}

/** What the scope holds right now, as the tab already knows it. */
export interface MemoryScopeState {
  /** File names listed in the group. */
  names: readonly string[];
  /** Whether the scope has a `MEMORY.md` index. */
  hasIndex: boolean;
}

/** What one import mode would do to that scope, name by name. */
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
  doc: MemoryScopeExport,
  scope: MemoryScopeState,
  mode: MemoryImportMode,
): MemoryImportPlan {
  const present = new Set(scope.names);
  const carried = new Set(doc.files.map((f) => f.name));
  const collides = doc.files.filter((f) => present.has(f.name)).map((f) => f.name);
  const added = doc.files.filter((f) => !present.has(f.name)).map((f) => f.name);
  const overwritten = mode === "skip" ? [] : collides;
  const skipped = mode === "skip" ? collides : [];
  const removed = mode === "replace" ? [...present].filter((name) => !carried.has(name)) : [];
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

/** File name of a downloaded scope document, matching the Content-Disposition the export route sets. */
export function memoryDocumentFileName(agentId: string, scopeKey: string): string {
  return `${agentId}-${scopeKey}-memory.json`;
}
