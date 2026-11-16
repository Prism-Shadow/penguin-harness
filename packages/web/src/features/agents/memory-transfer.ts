/**
 * Whole-scope transfer for the Memory tab: turning a picked file into an import, and reading
 * what a refused import says is at stake. Pure — mirrors memory-chat-prompts.ts, exported for
 * unit tests.
 *
 * The export is a zip of the group's folder, so a picked zip goes up as it is (base64, as the
 * Skill and workbench archives travel) and the server, which reads it, is the one to check it
 * and to plan the import: an import that would destroy something comes back as a 409 naming
 * the memories at stake, and the tab asks about exactly those before it sends `confirm`. A JSON
 * file is a version 1 document an earlier version exported; it still imports.
 *
 * Read `S` inside the functions, never at module top level: the dictionary binding is swapped
 * on language switch.
 */
import type { MemoryImportRequest, MemoryScopeExport } from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";

/** Format marker of a version 1 document, typed against the DTO so this literal cannot drift from the server's. */
const SCOPE_FORMAT: MemoryScopeExport["format"] = "penguin-memory-scope";
/**
 * The JSON document an export wrote before the zip; the server still imports it. Retired with
 * the server's reader at 1.0 (server services/memory-transfer-document.ts says what goes).
 */
const SCOPE_FORMAT_VERSION: MemoryScopeExport["version"] = 1;

/** A picked file that is neither a zip nor a version 1 document. Its message is already localized, so callers toast it as is. */
export class MemoryDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryDocumentError";
  }
}

/** What a picked file uploads as: exactly one of a zip and a version 1 document. */
export type MemoryUpload = Pick<MemoryImportRequest, "dataBase64" | "payload">;

/** A zip's magic bytes, `PK`. */
const isZip = (bytes: Uint8Array): boolean => bytes[0] === 0x50 && bytes[1] === 0x4b;

/** Base64 of some bytes, a chunk at a time so a large zip never builds one huge argument list. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function isTransferFile(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.name === "string" && typeof entry.content === "string";
}

/**
 * Reads a picked file as an import. A zip goes up whole; anything else must be a version 1 JSON
 * document, of which only the shape is checked here — names, sizes and counts are the server's to
 * enforce, and a second copy of those bounds would only drift.
 */
export function memoryUploadOf(bytes: Uint8Array): MemoryUpload {
  if (isZip(bytes)) return { dataBase64: toBase64(bytes) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
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
  return { payload: doc as unknown as MemoryScopeExport };
}

/** What an import would cost the group, as the server named it when it asked for confirmation. */
export interface MemoryImportPlan {
  /** Memories whose topic and folder the file would replace. */
  overwritten: string[];
  /** Memories deleted because the file does not carry them (`<folder>/` for a folder with no topic). */
  removed: string[];
  /** Whether the group's existing index would be replaced wholesale. */
  replacesIndex: boolean;
}

/** A details field the server wrote as a JSON array of names; empty when it is anything else. */
function namesIn(raw: string | undefined): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The plan a refused import carries (409 `memory_import_confirm_required`), for the confirmation
 * to name; null for any other error, which the caller reports as it is.
 */
export function importConfirmPlan(err: unknown): MemoryImportPlan | null {
  if (!(err instanceof ApiError) || err.code !== "memory_import_confirm_required") return null;
  return {
    overwritten: namesIn(err.details?.overwritten),
    removed: namesIn(err.details?.removed),
    replacesIndex: err.details?.replacesIndex === "true",
  };
}
