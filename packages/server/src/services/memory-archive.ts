/**
 * A memory scope as a zip: what GET …/memory/scopes/:key/export hands out and POST …/import takes
 * back (base64, as the Skill and workbench archives travel). The zip is the scope folder with its
 * files as files, at the zip's root: `MEMORY.md`, each topic `<name>.md`, and each folder's files
 * as `<folder>/<path>` — a topic's scripts in its folder of the same name, or a folder no topic
 * keeps. Never the `.workspace` marker or any other dot entry, so an export imports back unchanged.
 *
 * The Skill archive's caps (skill-import-limits.ts) bound both directions, its file count raised
 * for a scope's scripts, and an upload is checked as every archive import here checks one: the
 * caps read off the central directory before an entry is inflated, no path that climbs out or
 * carries a control character, no link or special entry, no two names a disk that ignores letter
 * case takes for one. Every entry is classified before anything is returned, so a refusal writes
 * nothing.
 */
import { isUtf8 } from "node:buffer";
import { zipSync } from "fflate";
import { MEMORY_INDEX_FILENAME } from "@prismshadow/penguin-core";
import { HttpError, badRequest } from "../http/errors.js";
import {
  MAX_ARCHIVE_BYTES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  assertSafeEntryPath,
  unzipBounded,
} from "./skill-import-limits.js";
import { CONTROL_CHARACTER, assertDistinctPaths, specialEntries } from "./zip-entries.js";

/**
 * Files one memory zip may hold, the index and the topics included. A scope the model keeps runs
 * to tens of memories and a handful of scripts each; this is far past that, and the byte caps
 * bound the rest.
 */
export const MAX_MEMORY_ARCHIVE_FILES = 1000;

/** The longest name a disk keeps, in UTF-8 bytes (ext4, APFS and NTFS alike). */
const MAX_SEGMENT_BYTES = 255;

/** One memory an import carries: a topic file, the files of the folder of its name, or both. */
export interface ImportedMemory {
  /** The folder's name, which is also the topic file's name without `.md`. */
  stem: string;
  /** The topic file, or null for a folder carried without one. */
  topic: { name: string; content: string | Uint8Array } | null;
  /** The folder's files, by their path inside it. */
  files: Map<string, Uint8Array>;
}

/** What an import carries, whatever form it came in. */
export interface MemoryImportSet {
  /** The scope's `MEMORY.md`, or null when the import carries none. */
  index: string | null;
  memories: ImportedMemory[];
}

/** The rules a memory file's name follows, kept with the service that resolves them (no dot prefix, no separator, a topic is a `*.md` that is not the index). */
export interface MemoryNameRules {
  isTopicFileName: (name: string) => boolean;
  isPlainName: (name: string) => boolean;
}

export function memoryTooLarge(): HttpError {
  return new HttpError(
    413,
    "memory_too_large",
    `The memory group exceeds the archive limits (${MAX_MEMORY_ARCHIVE_FILES} files, 5MB per file, 20MB total).`,
  );
}

/**
 * Zips a scope's files, given by their path in the scope. Past the caps the answer is 413
 * `memory_too_large` rather than a zip the import would refuse.
 */
export function zipMemoryArchive(files: Map<string, Uint8Array>): Uint8Array {
  if (files.size > MAX_MEMORY_ARCHIVE_FILES) throw memoryTooLarge();
  let total = 0;
  const entries: Record<string, Uint8Array> = {};
  for (const [rel, data] of files) {
    total += data.byteLength;
    if (data.byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw memoryTooLarge();
    entries[rel] = data;
  }
  return zipSync(entries);
}

/**
 * Decodes and checks an uploaded memory zip. Its root holds `MEMORY.md`, topic files and folders;
 * a folder's files sit at any depth under it, every segment a plain name. Anything else — a file
 * at the root that is no topic, a dot entry, a link — refuses the whole zip.
 */
export function parseMemoryArchive(archive: Uint8Array, rules: MemoryNameRules): MemoryImportSet {
  if (archive.byteLength === 0) throw badRequest("The zip archive is empty.");
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw badRequest(`The zip archive exceeds the ${MAX_ARCHIVE_BYTES / (1024 * 1024)}MB limit.`);
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipBounded(archive, { maxFiles: MAX_MEMORY_ARCHIVE_FILES });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest("dataBase64 is not a valid zip archive.");
  }
  for (const name of Object.keys(entries)) {
    assertSafeEntryPath(name);
    if (CONTROL_CHARACTER.test(name)) {
      throw badRequest(`Invalid zip entry path (control character): ${JSON.stringify(name)}`);
    }
  }
  const special = specialEntries(archive);
  if (special.length > 0) {
    throw badRequest(
      `A memory group holds regular files only; this entry is a link or a special file: ${special[0]}`,
    );
  }
  assertDistinctPaths(Object.keys(entries), badRequest);

  let index: string | null = null;
  const memories = new Map<string, ImportedMemory>();
  const memoryOf = (stem: string): ImportedMemory => {
    let memory = memories.get(stem);
    if (memory === undefined) {
      memory = { stem, topic: null, files: new Map() };
      memories.set(stem, memory);
    }
    return memory;
  };
  for (const [name, data] of Object.entries(entries)) {
    const segments = name.split("/");
    if (segments.some((s) => Buffer.byteLength(s, "utf8") > MAX_SEGMENT_BYTES)) {
      throw badRequest(`A file name must be at most ${MAX_SEGMENT_BYTES} bytes: ${name}`);
    }
    if (segments.length === 1 && name === MEMORY_INDEX_FILENAME) {
      if (!isUtf8(data)) throw badRequest(`${MEMORY_INDEX_FILENAME} must be UTF-8 text.`);
      index = Buffer.from(data).toString("utf8");
    } else if (segments.length === 1 && rules.isTopicFileName(name)) {
      memoryOf(name.slice(0, -".md".length)).topic = { name, content: data };
    } else if (segments.length > 1 && segments.every(rules.isPlainName)) {
      memoryOf(segments[0]!).files.set(segments.slice(1).join("/"), data);
    } else {
      throw badRequest(
        `Zip entry is not a memory file (${MEMORY_INDEX_FILENAME}, a topic <name>.md, or a file in a folder, with no dot entries): ${name}`,
      );
    }
  }
  return { index, memories: [...memories.values()] };
}
