/**
 * A workbench as a zip: what `POST …/workbenches/archive` takes in and `GET …/:id/archive` hands
 * out. Only source travels — the files a folder's revision covers (./store.ts): never
 * `state.json` (the workbench's data), a dot entry (the server's `.build/`, `.harness/`,
 * `.plugin.json`), `node_modules` or a staging file of ours. The export puts them under one
 * top-level `<id>/`, so it imports back unchanged. The Skill archive's caps
 * (../services/skill-import-limits.ts) bound both directions: an inflated upload before a byte
 * of it is inflated, and an export because what exceeds them could not be imported again.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8 } from "fflate";
import { atomicWriteFile } from "@prismshadow/penguin-core";
import { HttpError, badRequest } from "../http/errors.js";
import {
  MAX_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  assertSafeEntryPath,
  unzipBounded,
} from "../services/skill-import-limits.js";
import { HARNESS_DIR } from "./harness-types.js";
import {
  STATE_FILE,
  isSafeRelPath,
  isTempName,
  isWorkbenchId,
  readFolder,
  type WorkbenchFolder,
} from "./store.js";

/** A workbench decoded from a zip: its id, and each source file keyed by its path in the folder. */
export interface WorkbenchArchive {
  id: string;
  files: Map<string, Uint8Array>;
}

const TO_DIRECTORY = "put the files under a directory named after the workbench";

/** Why an entry is not workbench source, judged on every segment of its path; null when it is. */
function notSource(name: string): string | null {
  if (!isSafeRelPath(name)) return "not a plain relative path";
  for (const segment of name.split("/")) {
    if (segment.startsWith(".")) return "dot entries are the server's";
    if (segment === "node_modules") return "node_modules is never imported";
    if (isTempName(segment)) return "a staging file of the server's";
  }
  return null;
}

/** `package.json` must parse and list the modules; what else it gets wrong, the load reports. */
function readPackage(bytes: Uint8Array): Record<string, unknown> {
  let pkg: unknown;
  try {
    pkg = JSON.parse(strFromU8(bytes));
  } catch {
    throw badRequest("package.json is not valid JSON.");
  }
  if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) {
    throw badRequest("package.json must be a JSON object.");
  }
  const modules = (pkg as { penguin?: { modules?: unknown } }).penguin?.modules;
  if (!Array.isArray(modules) || modules.length === 0) {
    throw badRequest("package.json must list the workbench's modules under penguin.modules.");
  }
  return pkg as Record<string, unknown>;
}

/** A root-layout archive has no directory to name it, so its package.json's `name` does. */
function idOfRootPackage(pkg: Record<string, unknown>): string {
  const name = pkg.name;
  if (typeof name !== "string" || name === "") {
    throw badRequest(
      `package.json at the zip root must set name to the workbench id, or ${TO_DIRECTORY}.`,
    );
  }
  if (name.startsWith("@")) {
    throw badRequest(
      `package.json names a scoped package (${name}), which is not a workbench id: ${TO_DIRECTORY}.`,
    );
  }
  return name;
}

/**
 * Decodes and checks an uploaded workbench zip. Accepted layouts: package.json at the zip root
 * (its `name` is the id), or exactly one top-level directory holding it (the directory's name is
 * the id, as a folder's name is in the listing). Directory entries are ignored; every file is
 * checked before anything is returned, so a refusal writes nothing.
 */
export function parseWorkbenchArchive(archive: Buffer): WorkbenchArchive {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipBounded(new Uint8Array(archive));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest("dataBase64 is not a valid zip archive.");
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (files.length === 0) throw badRequest("The zip archive contains no files.");
  for (const [name] of files) {
    assertSafeEntryPath(name);
    const reason = notSource(name);
    if (reason !== null) throw badRequest(`Zip entry is not workbench source (${reason}): ${name}`);
  }
  const names = files.map(([name]) => name);
  let prefix = "";
  let dirName: string | undefined;
  if (!names.includes("package.json")) {
    const topLevels = new Set(names.map((name) => name.split("/", 1)[0]!));
    dirName = topLevels.size === 1 ? [...topLevels][0] : undefined;
    if (dirName === undefined || !names.includes(`${dirName}/package.json`)) {
      throw badRequest(
        "The zip must contain package.json at its root, or exactly one top-level directory containing package.json.",
      );
    }
    prefix = `${dirName}/`;
  }
  const pkg = readPackage(entries[`${prefix}package.json`]!);
  const id = dirName ?? idOfRootPackage(pkg);
  if (!isWorkbenchId(id)) {
    throw badRequest(
      `Invalid workbench id ${JSON.stringify(id)}: up to 64 letters, digits, ".", "_" and "-", starting with a letter or digit.`,
    );
  }
  const source = new Map<string, Uint8Array>();
  for (const [name, data] of files) {
    const rel = name.slice(prefix.length);
    // A file entry named exactly like the top-level directory would be written onto the folder itself.
    if (rel === "")
      throw badRequest(`Invalid zip entry path (it is the workbench directory): ${name}`);
    if (rel === STATE_FILE) {
      throw badRequest(
        `Zip entry is not workbench source (state.json is the workbench's data): ${name}`,
      );
    }
    source.set(rel, data);
  }
  for (const rel of source.keys()) {
    const segments = rel.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      const parent = segments.slice(0, depth).join("/");
      if (source.has(parent)) {
        throw badRequest(`Zip entry is both a file and a directory: ${prefix}${parent}`);
      }
    }
  }
  return { id, files: source };
}

export function workbenchTooLarge(): HttpError {
  return new HttpError(
    413,
    "workbench_too_large",
    `Workbench source exceeds the archive limits (${MAX_ARCHIVE_FILES} files, 5MB per file, 20MB total).`,
  );
}

/**
 * The folder's source as zip entries under `<id>/`. A file listed a moment ago and gone by now
 * (an editor's scratch, the Agent mid-edit) is left out, as the revision leaves it out.
 */
export async function collectWorkbenchArchive(
  folder: WorkbenchFolder,
): Promise<Record<string, Uint8Array>> {
  if (folder.files.length > MAX_ARCHIVE_FILES) throw workbenchTooLarge();
  const out: Record<string, Uint8Array> = {};
  let total = 0;
  for (const rel of folder.files) {
    let data: Uint8Array;
    try {
      data = new Uint8Array(await fs.readFile(path.join(folder.dir, rel)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    total += data.byteLength;
    if (data.byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw workbenchTooLarge();
    out[`${folder.id}/${rel}`] = data;
  }
  return out;
}

/** `<id>.zip`, or `<id>-v<version>.zip` when package.json's `version` is fit for a file name. */
export function workbenchArchiveName(folder: WorkbenchFolder): string {
  const version = folder.pkg.version;
  return version !== null && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(version)
    ? `${folder.id}-v${version}.zip`
    : `${folder.id}.zip`;
}

/** Each directory between `dir` and `rel`'s file, none of them a link out of the folder. */
async function realParents(dir: string, rel: string, create: boolean): Promise<string[]> {
  const parents: string[] = [];
  let parent = dir;
  for (const part of rel.split("/").slice(0, -1)) {
    parent = path.join(parent, part);
    if (create) await fs.mkdir(parent, { recursive: true });
    const stat = await fs.lstat(parent).catch(() => null);
    if (stat === null) break;
    if (!stat.isDirectory()) {
      throw new Error(`Workbench source directory is a symlink or a file: ${rel}`);
    }
    parents.push(parent);
  }
  return parents;
}

/** Removes every source file of the folder `keep` does not name, and the directories that empties. */
async function removeStale(dir: string, keep: ReadonlyMap<string, Uint8Array>): Promise<void> {
  const folder = await readFolder(dir, path.basename(dir));
  for (const rel of folder?.files ?? []) {
    if (keep.has(rel)) continue;
    const parents = await realParents(dir, rel, false);
    await fs.rm(path.join(dir, rel), { force: true });
    for (const parent of parents.reverse()) {
      // The first directory something else still lives in ends the climb.
      const emptied = await fs.rmdir(parent).then(
        () => true,
        () => false,
      );
      if (!emptied) break;
    }
  }
}

/**
 * Makes `dir`'s source exactly `files`: source files the archive lacks are removed (stale ones
 * first, so a file that becomes a directory or the reverse has room), each file is written
 * atomically in place, and `.harness/` is removed so the next load writes this host's types — as
 * a plugin update does. `state.json`, `.plugin.json` and `.build/` stay. The folder itself is
 * written in place rather than swapped: the watcher holds the folder above it open, and a held
 * directory cannot be renamed on Windows.
 */
export async function writeWorkbenchSource(
  dir: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  if (!(await fs.lstat(dir)).isDirectory()) {
    throw new Error(`Workbench folder is not a directory: ${dir}`);
  }
  await removeStale(dir, files);
  for (const [rel, body] of files) {
    await realParents(dir, rel, true);
    await atomicWriteFile(path.join(dir, rel), body);
  }
  // A folder that was not a workbench before (no package.json) listed nothing to remove above.
  await removeStale(dir, files);
  await fs.rm(path.join(dir, HARNESS_DIR), { recursive: true, force: true });
}
