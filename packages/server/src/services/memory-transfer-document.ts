/**
 * The Memory scope transfer document (`format: "penguin-memory-scope"`): its version, the bounds
 * one import may carry, and the reader that checks an untrusted document before any of it is
 * believed. MemoryService writes what this returns; the export side builds the document itself.
 *
 * Two versions are read. Version 2 is what this server writes: each entry names its place in the
 * scope with `path` — `<name>.md` for a topic, `scripts/<name>` for a script. Version 1, written
 * before scope directories held scripts, names a topic with `name`; such a document still
 * imports, its entries read as topic paths. A server from before version 2 refuses a version 2
 * document as an unknown version, which is the format's stated compatibility (no code here
 * bridges it).
 */
import { MEMORY_SCRIPTS_DIR } from "@prismshadow/penguin-core";
import type { MemoryScopeExport, MemoryTransferFile } from "../api/types.js";
import { badRequest } from "../http/validate.js";

/** The document's format marker, checked before anything in it is believed. Typed against the DTO so the two literals cannot drift apart. */
export const SCOPE_FORMAT: MemoryScopeExport["format"] = "penguin-memory-scope";

/** The version this server writes. */
export const SCOPE_FORMAT_VERSION: MemoryScopeExport["version"] = 2;

/**
 * The topics-only version that predates scripts; still read, never written, so an export kept
 * from before scripts imports here (changelog 2026-11-04-backward-compatibility). Retirement: the
 * Memory maintainers remove this version and its `name` branch below at 1.0's release
 * preparation, with the web reader's twin (web features/agents/memory-transfer.ts) and the
 * version 1 import tests; a version 1 file is then refused as an unknown version.
 */
const SCOPE_FORMAT_VERSION_TOPICS_ONLY = 1;

/**
 * What one import may carry.
 *
 * These are Memory's own numbers, not the attachment budget's: an attachment is an opaque blob
 * handed to the model's file tools, while a memory is text the model wrote for itself to re-read,
 * and 100MB of it would be a scope no index could describe. The request as a whole is already
 * bounded by the API body cap before any of this runs — what follows bounds what one scope
 * directory can be made to hold.
 */
/** Entries one document may carry, topics and scripts together. A scope the model keeps by hand runs to tens of files, so this is far past ordinary use and still a directory that lists. */
const MAX_IMPORT_FILES = 500;

/** Scripts one document may carry. A script is a program the Agent reuses, and a scope with more than a hundred of them is no longer something its index can describe. */
const MAX_IMPORT_SCRIPTS = 100;

/**
 * Bytes of one file's text (UTF-8), the index included. A memory that does not fit in 512KB is
 * not a memory. The same bound decides which scripts the Memory routes read and export: a larger
 * one is listed, and left out of a document with a note.
 */
export const MEMORY_FILE_MAX_BYTES = 512 * 1024;

/** Bytes across the whole document: one scope directory's total. */
const MAX_IMPORT_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * Bytes of one file name. The name rule says nothing about length, and a name longer than the
 * filesystem's own limit for a path component fails at the write with ENAMETOOLONG — a 500 for
 * what is plainly a bad request. 255 is that limit on ext4, APFS and NTFS alike.
 */
const MAX_IMPORT_NAME_BYTES = 255;

/** The prefix of a script's path inside its scope. */
export const SCRIPT_PATH_PREFIX = `${MEMORY_SCRIPTS_DIR}/`;

/**
 * Validates a transfer document on its way to the server's disk.
 *
 * Everything here is untrusted: the document may have been hand-written, produced by another
 * tool, or crafted. So the shape is checked field by field before any of it is believed, and the
 * result carries only what was verified — the entry paths are handed to the same name check that
 * guards every other write (MemoryService's `resolveEntry`), which is what keeps one definition of
 * "a legal memory file" in the service.
 *
 * Refuses, with the reason: a foreign or unknown version, entries that are not text, a name that
 * carries a NUL or is longer than a path component may be (both of which the filesystem layer
 * would throw on rather than reject), the same path twice, and any of the count and size bounds.
 * A version 2 document's `omitted` list is the exporter's note and is not read.
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
      `payload.version must be ${SCOPE_FORMAT_VERSION} (or ${SCOPE_FORMAT_VERSION_TOPICS_ONLY}, from before scripts).`,
    );
  }
  // Where an entry says it belongs: `path` from version 2 on, a topic's `name` before it.
  const locator = doc.version === SCOPE_FORMAT_VERSION ? "path" : "name";
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
  let scripts = 0;
  for (const entry of doc.files) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest("Each payload.files entry must be an object.");
    }
    const fields = entry as Record<string, unknown>;
    const at = fields[locator];
    const content = fields.content;
    if (typeof at !== "string") throw badRequest(`Each payload.files entry needs a ${locator}.`);
    if (typeof content !== "string") {
      throw badRequest(`Content of ${at} must be a string.`);
    }
    if (at.includes("\u0000")) throw badRequest("A file name must be text.");
    const isScript = at.startsWith(SCRIPT_PATH_PREFIX);
    const fileName = isScript ? at.slice(SCRIPT_PATH_PREFIX.length) : at;
    if (Buffer.byteLength(fileName, "utf8") > MAX_IMPORT_NAME_BYTES) {
      throw badRequest(`A file name must be at most ${MAX_IMPORT_NAME_BYTES} bytes.`);
    }
    if (isScript && ++scripts > MAX_IMPORT_SCRIPTS) {
      throw badRequest(`payload.files must hold at most ${MAX_IMPORT_SCRIPTS} scripts.`);
    }
    if (seen.has(at)) throw badRequest(`payload.files names ${at} twice.`);
    seen.add(at);
    measure(content, `Content of ${at}`);
    files.push({ path: at, content });
  }
  return { index, files };
}
