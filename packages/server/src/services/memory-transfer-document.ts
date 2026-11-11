/**
 * The Memory scope transfer document (`format: "penguin-memory-scope"`): its version, the bounds
 * one import may carry, and the reader that checks an untrusted document before any of it is
 * believed. MemoryService writes what this returns; the export side builds the document itself.
 *
 * Two versions are read. Version 2 is what this server writes: each topic, named by its file
 * name, may carry the files its folder keeps (`files`, each by its path inside that folder).
 * Version 1, written before a topic kept files, is the same document without them; it still
 * imports. A server from before version 2 refuses a version 2 document as an unknown version,
 * which is the format's stated compatibility (no code here bridges it).
 */
import type { MemoryScopeExport, MemoryTransferFile } from "../api/types.js";
import { badRequest } from "../http/validate.js";

/** The document's format marker, checked before anything in it is believed. Typed against the DTO so the two literals cannot drift apart. */
export const SCOPE_FORMAT: MemoryScopeExport["format"] = "penguin-memory-scope";

/** The version this server writes. */
export const SCOPE_FORMAT_VERSION: MemoryScopeExport["version"] = 2;

/**
 * The version from before a topic kept files; still read, never written, so an export kept from
 * before imports here (changelog 2026-11-04-backward-compatibility). Retirement: the Memory
 * maintainers remove this version at 1.0's release preparation, with the web reader's twin (web
 * features/agents/memory-transfer.ts) and the version 1 import test; a version 1 file is then
 * refused as an unknown version.
 */
const SCOPE_FORMAT_VERSION_TOPICS_ONLY = 1;

/**
 * What one import may carry.
 *
 * These are Memory's own numbers, not the attachment budget's: an attachment is an opaque blob
 * handed to the model's file tools, while a memory is text the model wrote for itself to re-read,
 * and 100MB of it would be a scope no index could describe. The request as a whole is already
 * bounded by the API body cap before any of this runs — what follows bounds what one scope
 * directory can be made to hold. How many files a topic keeps is not counted: the byte budgets
 * already bound what a document can write, and a count would limit the model rather than guard
 * the server.
 */
/** Topics one document may carry. A scope the model keeps by hand runs to tens of files, so this is far past ordinary use and still a directory that lists. */
const MAX_IMPORT_FILES = 500;

/**
 * Bytes of one file's text (UTF-8), the index included. A memory that does not fit in 512KB is
 * not a memory. The same bound decides which of a topic's files the Memory routes read and
 * export: a larger one is listed, and left out of a document with a note.
 */
export const MEMORY_FILE_MAX_BYTES = 512 * 1024;

/** Bytes across the whole document: one scope directory's total. */
const MAX_IMPORT_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * Bytes of one file or folder name. The name rule says nothing about length, and a name longer
 * than the filesystem's own limit for a path component fails at the write with ENAMETOOLONG — a
 * 500 for what is plainly a bad request. 255 is that limit on ext4, APFS and NTFS alike.
 */
const MAX_IMPORT_NAME_BYTES = 255;

/** A path component's length check, shared by a topic's name and every segment of its files' paths. */
function checkNameLength(name: string): void {
  if (Buffer.byteLength(name, "utf8") > MAX_IMPORT_NAME_BYTES) {
    throw badRequest(`A file name must be at most ${MAX_IMPORT_NAME_BYTES} bytes.`);
  }
}

/**
 * Validates a transfer document on its way to the server's disk.
 *
 * Everything here is untrusted: the document may have been hand-written, produced by another
 * tool, or crafted. So the shape is checked field by field before any of it is believed, and the
 * result carries only what was verified — the names and paths are handed to the same rules that
 * guard every other write (MemoryService's `resolveFile` and `folderPathSegments`), which is what
 * keeps one definition of "a legal memory file" in the service.
 *
 * Refuses, with the reason: a foreign or unknown version, entries that are not text, a name that
 * carries a NUL or a path component longer than the filesystem allows (both of which the
 * filesystem layer would throw on rather than reject), the same topic or the same file twice, a
 * file whose path runs through another file of the same topic, and any of the size bounds. A
 * version 2 document's `omitted` list is the exporter's note and is not read.
 */
export function parseTransferDocument(payload: unknown): {
  index: string | null;
  files: MemoryTransferFile[];
} {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw badRequest("payload must be a Memory scope export object.");
  }
  const doc = payload as Record<string, unknown>;
  if (doc.format !== SCOPE_FORMAT) {
    throw badRequest(`payload.format must be "${SCOPE_FORMAT}".`);
  }
  if (doc.version !== SCOPE_FORMAT_VERSION && doc.version !== SCOPE_FORMAT_VERSION_TOPICS_ONLY) {
    throw badRequest(
      `payload.version must be ${SCOPE_FORMAT_VERSION} (or ${SCOPE_FORMAT_VERSION_TOPICS_ONLY}, from before a topic kept files).`,
    );
  }
  const keepsFiles = doc.version === SCOPE_FORMAT_VERSION;
  if (!Array.isArray(doc.files)) throw badRequest("payload.files must be an array.");
  if (doc.files.length > MAX_IMPORT_FILES) {
    throw badRequest(`payload.files must hold at most ${MAX_IMPORT_FILES} entries.`);
  }
  let total = 0;
  const measure = (text: string, label: string): void => {
    if (text.includes("\u0000")) throw badRequest(`${label} must be text.`);
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MEMORY_FILE_MAX_BYTES) {
      throw badRequest(`${label} exceeds the ${MEMORY_FILE_MAX_BYTES / 1024}KB limit.`);
    }
    total += bytes;
    if (total > MAX_IMPORT_TOTAL_BYTES) {
      throw badRequest(
        `payload exceeds the ${MAX_IMPORT_TOTAL_BYTES / (1024 * 1024)}MB total limit.`,
      );
    }
  };

  let index: string | null = null;
  if (doc.index !== null && doc.index !== undefined) {
    if (typeof doc.index !== "string") throw badRequest("payload.index must be a string or null.");
    measure(doc.index, "payload.index");
    index = doc.index;
  }

  const files: MemoryTransferFile[] = [];
  const seen = new Set<string>();
  for (const entry of doc.files) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest("Each payload.files entry must be an object.");
    }
    const fields = entry as Record<string, unknown>;
    const name = fields.name;
    const content = fields.content;
    if (typeof name !== "string") throw badRequest("Each payload.files entry needs a name.");
    if (typeof content !== "string") {
      throw badRequest(`Content of ${name} must be a string.`);
    }
    if (name.includes("\u0000")) throw badRequest("A file name must be text.");
    checkNameLength(name);
    if (seen.has(name)) throw badRequest(`payload.files names ${name} twice.`);
    seen.add(name);
    measure(content, `Content of ${name}`);
    const kept = keepsFiles ? readKeptFiles(fields.files, name, measure) : [];
    files.push(kept.length > 0 ? { name, content, files: kept } : { name, content });
  }
  return { index, files };
}

/**
 * One topic's `files` list: absent or empty when it keeps none. Each entry's path is inside the
 * topic's folder, `/`-separated; the segment rule itself is the service's, checked before any
 * write, while what only the document as a whole can show — a path given twice, or one that runs
 * through another file of the same topic — is refused here.
 */
function readKeptFiles(
  value: unknown,
  topic: string,
  measure: (text: string, label: string) => void,
): { path: string; content: string }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest(`The files of ${topic} must be an array.`);
  const kept: { path: string; content: string }[] = [];
  const paths = new Set<string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest(`Each file of ${topic} must be an object.`);
    }
    const fields = entry as Record<string, unknown>;
    const at = fields.path;
    const content = fields.content;
    if (typeof at !== "string") throw badRequest(`Each file of ${topic} needs a path.`);
    if (typeof content !== "string") throw badRequest(`Content of ${at} must be a string.`);
    if (at.includes("\u0000")) throw badRequest("A file path must be text.");
    for (const segment of at.split("/")) checkNameLength(segment);
    if (paths.has(at)) throw badRequest(`The files of ${topic} name ${at} twice.`);
    paths.add(at);
    measure(content, `Content of ${at}`);
    kept.push({ path: at, content });
  }
  // A file cannot also be a folder: `lib` and `lib/io.py` side by side would fail at the write.
  for (const at of paths) {
    const segments = at.split("/");
    for (let i = 1; i < segments.length; i++) {
      const folder = segments.slice(0, i).join("/");
      if (paths.has(folder)) {
        throw badRequest(`The files of ${topic} hold ${folder} both as a file and as a folder.`);
      }
    }
  }
  return kept;
}
