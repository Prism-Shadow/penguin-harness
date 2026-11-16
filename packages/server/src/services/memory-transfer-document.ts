/**
 * The JSON transfer document an export answered with up to 0.2.x (`format: "penguin-memory-scope"`,
 * `version: 1`): the topic files and the scope's `MEMORY.md`. The export is a zip of the scope
 * folder now (memory-archive.ts); an import still reads this document, so a backup kept from
 * before imports here (changelog 2026-11-04-backward-compatibility). Retirement: the Memory
 * maintainers remove this module, the route's `payload` branch, `MemoryScopeExport` and the web
 * reader's JSON branch (web features/agents/memory-transfer.ts) at 1.0's release preparation,
 * with the version 1 import test; a JSON file is then refused like any other non-zip upload.
 */
import type { MemoryScopeExport, MemoryTransferFile } from "../api/types.js";
import { badRequest } from "../http/validate.js";
import type { MemoryImportSet } from "./memory-archive.js";

/** The document's format marker, checked before anything in it is believed. Typed against the DTO so the two literals cannot drift apart. */
const SCOPE_FORMAT: MemoryScopeExport["format"] = "penguin-memory-scope";

/** The one version ever written. */
const SCOPE_FORMAT_VERSION: MemoryScopeExport["version"] = 1;

/**
 * What one document may carry.
 *
 * These are Memory's own numbers, not the attachment budget's: an attachment is an opaque blob
 * handed to the model's file tools, while a memory is Markdown the model wrote for itself to
 * re-read, and 100MB of it would be a scope no index could describe. The request as a whole is
 * already bounded by the API body cap before any of this runs — what follows bounds what one
 * scope directory can be made to hold.
 */
/** Topic files one document may carry. A scope the model keeps by hand runs to tens of files, so this is far past ordinary use and still a directory that lists. */
export const MAX_IMPORT_FILES = 500;

/** Bytes of one file's text (UTF-8), the index included. A memory that does not fit in 512KB of Markdown is not a memory. */
export const MAX_IMPORT_FILE_BYTES = 512 * 1024;

/** Bytes across the whole document: one scope directory's total. */
export const MAX_IMPORT_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * Bytes of one file name. The name rule says nothing about length, and a name longer than the
 * filesystem's own limit for a path component fails at the write with ENAMETOOLONG — a 500 for
 * what is plainly a bad request. 255 is that limit on ext4, APFS and NTFS alike.
 */
export const MAX_IMPORT_NAME_BYTES = 255;

/**
 * Validates a version 1 document on its way to the server's disk, as the import that writes it
 * takes it: one memory per topic, with no files.
 *
 * Everything here is untrusted: the document may have been hand-written, produced by another
 * tool, or crafted. So the shape is checked field by field before any of it is believed, and the
 * result carries only what was verified — the entry names are handed to the same `resolveFile`
 * check that guards every other write, which is what keeps one definition of "a legal memory
 * file name" in the service.
 *
 * Refuses, with the reason: a foreign or unknown format, entries that are not text, a name that
 * carries a NUL or is longer than a path component may be (both of which the filesystem layer
 * would throw on rather than reject), the same name twice, and any of the size bounds.
 */
export function parseTransferDocument(payload: unknown): MemoryImportSet {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw badRequest("payload must be a Memory scope export object.");
  }
  const doc = payload as Record<string, unknown>;
  if (doc.format !== SCOPE_FORMAT) {
    throw badRequest(`payload.format must be "${SCOPE_FORMAT}".`);
  }
  if (doc.version !== SCOPE_FORMAT_VERSION) {
    throw badRequest(`payload.version must be ${SCOPE_FORMAT_VERSION}.`);
  }
  if (!Array.isArray(doc.files)) throw badRequest("payload.files must be an array.");
  if (doc.files.length > MAX_IMPORT_FILES) {
    throw badRequest(`payload.files must hold at most ${MAX_IMPORT_FILES} entries.`);
  }
  let total = 0;
  const measure = (text: string, label: string): void => {
    if (text.includes("\u0000")) throw badRequest(`${label} must be text.`);
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_IMPORT_FILE_BYTES) {
      throw badRequest(`${label} exceeds the ${MAX_IMPORT_FILE_BYTES / 1024}KB limit.`);
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
    const { name, content } = entry as Record<string, unknown>;
    if (typeof name !== "string") throw badRequest("Each payload.files entry needs a name.");
    if (typeof content !== "string") {
      throw badRequest(`Content of ${name} must be a string.`);
    }
    if (name.includes("\u0000")) throw badRequest("A file name must be text.");
    if (Buffer.byteLength(name, "utf8") > MAX_IMPORT_NAME_BYTES) {
      throw badRequest(`A file name must be at most ${MAX_IMPORT_NAME_BYTES} bytes.`);
    }
    if (seen.has(name)) throw badRequest(`payload.files names ${name} twice.`);
    seen.add(name);
    measure(content, `Content of ${name}`);
    files.push({ name, content });
  }
  return {
    index,
    memories: files.map((f) => ({
      stem: f.name.slice(0, -".md".length),
      topic: { name: f.name, content: f.content },
      files: new Map(),
    })),
  };
}
