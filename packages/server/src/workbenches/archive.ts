/**
 * A workbench as a zip: what `POST …/workbenches/archive` takes in and `GET …/:id/archive` hands
 * out. Only source travels — the files a folder's revision covers (./store.ts): never
 * `state.json` (the workbench's data), a dot entry (the server's `.build/`, `.harness/`,
 * `.plugin.json`), `node_modules` or a staging file of ours. The export puts them under one
 * top-level `<id>/`, so it imports back unchanged. The Skill archive's caps
 * (../services/skill-import-limits.ts) bound both directions.
 *
 * A name is judged the way the strictest disk an Agent State travels to judges it: letter case
 * and Unicode normal form folded, as macOS and Windows compare names, and Windows' own rules on
 * what a name may hold. So `State.json` is the state file, two entries one of those disks takes
 * for one are refused, and nothing is accepted that a copy of the folder could not hold there.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8 } from "fflate";
import { HttpError, badRequest } from "../http/errors.js";
import {
  MAX_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  assertSafeEntryPath,
  unzipBounded,
} from "../services/skill-import-limits.js";
import { CONTROL_CHARACTER, specialEntries } from "../services/zip-entries.js";
import { HARNESS_DIR } from "./harness-types.js";
import { removeLeftovers } from "./leftovers.js";
import { isGitName } from "./repo.js";
import {
  STATE_FILE,
  TMP_SUFFIX,
  isSafeRelPath,
  isTempName,
  isWorkbenchId,
  type WorkbenchFolder,
} from "./store.js";

/** A workbench decoded from a zip: its id, and each source file keyed by its path in the folder. */
export interface WorkbenchArchive {
  id: string;
  files: Map<string, Uint8Array>;
}

const TO_DIRECTORY = "put the files under a directory named after the workbench";

/** A name as a disk that ignores letter case and Unicode normal form (macOS, Windows) compares it. */
export function folded(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/** Windows reserves these device names, with or without an extension, in any letter case. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Characters no Windows name holds. */
const WINDOWS_FORBIDDEN = /[<>:"|?*]/;
/** The longest name a disk keeps, in UTF-8 bytes. */
const MAX_SEGMENT_BYTES = 255;

/** Why a path is not workbench source, judged on every segment; null when it is. */
function notSource(name: string): string | null {
  if (CONTROL_CHARACTER.test(name)) return "a control character";
  if (!isSafeRelPath(name)) return "not a plain relative path";
  for (const segment of name.split("/")) {
    const key = folded(segment);
    if (key.startsWith(".")) return "dot entries are the server's";
    if (key === "node_modules") return "node_modules is never imported";
    if (isTempName(key)) return "a staging file of the server's";
    if (isGitName(segment)) return "a name git reserves";
    if (
      WINDOWS_FORBIDDEN.test(segment) ||
      WINDOWS_RESERVED.test(segment) ||
      /[. ]$/.test(segment) ||
      Buffer.byteLength(segment) > MAX_SEGMENT_BYTES
    ) {
      return "a name Windows cannot hold";
    }
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

/**
 * A root-layout archive has no directory to name it, so its package.json's `name` does — and
 * that name becomes a folder's, so it is held to what an entry's directory would be.
 */
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
  const reason = notSource(name);
  if (reason !== null) {
    throw badRequest(
      `package.json names ${JSON.stringify(name)}, which no folder can be (${reason}).`,
    );
  }
  return name;
}

/**
 * Every path the folder will hold, as a disk that folds names sees it: two entries it takes for
 * one would land one over the other, and a file where another entry needs a directory would fail
 * the write half-way.
 */
function assertDistinct(rels: Iterable<string>, prefix: string): void {
  const claimed = new Map<string, { rel: string; directory: boolean }>();
  const claim = (rel: string, directory: boolean): void => {
    const key = folded(rel);
    const prior = claimed.get(key);
    if (prior === undefined) {
      claimed.set(key, { rel, directory });
    } else if (prior.directory !== directory) {
      throw badRequest(
        `Zip entry is both a file and a directory: ${prefix}${directory ? prior.rel : rel}`,
      );
    } else if (prior.rel !== rel) {
      throw badRequest(
        `Zip entry has the same name as ${prefix}${prior.rel} where letter case is ignored: ${prefix}${rel}`,
      );
    }
  };
  for (const rel of rels) {
    const segments = rel.split("/");
    for (let i = 1; i < segments.length; i++) claim(segments.slice(0, i).join("/"), true);
    claim(rel, false);
  }
}

/**
 * Decodes and checks an uploaded workbench zip. Accepted layouts: package.json at the zip root
 * (its `name` is the id), or exactly one top-level directory holding it (the directory's name is
 * the id, as a folder's name is in the listing). Directory entries are ignored; links and other
 * special entries are refused (fflate would hand a link back as a file holding its target); every
 * file is checked before anything is returned, so a refusal writes nothing.
 */
export function parseWorkbenchArchive(archive: Buffer): WorkbenchArchive {
  const zip = new Uint8Array(archive);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipBounded(zip);
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
  const special = specialEntries(zip);
  if (special.length > 0) {
    throw badRequest(
      `A workbench holds regular files only; this entry is a link or a special file: ${special[0]}`,
    );
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (files.length === 0) throw badRequest("The zip archive contains no files.");
  for (const [name] of files) {
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
    if (folded(rel.split("/", 1)[0]!) === STATE_FILE) {
      throw badRequest(
        `Zip entry is not workbench source (state.json is the workbench's data): ${name}`,
      );
    }
    source.set(rel, data);
  }
  assertDistinct(source.keys(), prefix);
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

/**
 * The folder an import of `id` writes to: the one already there whose name is `id` once letter
 * case and normal form are folded, spelled as it is on disk, else `id`. On a disk that folds names
 * the two are one folder whatever this answers; elsewhere this keeps them one, so the Agent State
 * still copies onto such a disk.
 */
export async function folderNameFor(base: string, id: string): Promise<string> {
  let names: string[];
  try {
    names = await fs.readdir(base);
  } catch {
    return id;
  }
  if (names.includes(id)) return id;
  return names.find((name) => isWorkbenchId(name) && folded(name) === folded(id)) ?? id;
}

function conflict(message: string): HttpError {
  return new HttpError(409, "workbench_conflict", message);
}

/**
 * The files readFolder counts as a folder's source (./store.ts), whether or not it has a
 * package.json yet: regular files, minus the root `state.json`, dot entries, `node_modules`,
 * staging files and names git reserves. A link is not followed.
 */
async function sourceFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (name === "node_modules" || name.startsWith(".") || isTempName(name) || isGitName(name)) {
      continue;
    }
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await sourceFiles(path.join(dir, entry.name), rel)));
    else if (entry.isFile() && rel !== STATE_FILE) out.push(rel);
  }
  return out;
}

/** The parent directories of `rel`, outermost first ("a", "a/b" for "a/b/c.ts"). */
function parentsOf(rel: string): string[] {
  const segments = rel.split("/");
  return segments.slice(1).map((_, i) => segments.slice(0, i + 1).join("/"));
}

/** Old source files the import removes: the ones in a new file's way go first, the rest last. */
interface Removals {
  inTheWay: string[];
  rest: string[];
}

/**
 * Checks the folder against the archive before anything is written, and says what goes. In a new
 * file's way is an old file a folding disk takes for a new one, an old file where a new file needs
 * a directory, and an old file under a directory where a new file goes. Refused (409): a folder
 * that is a link or a file, a link or another file where a new file needs a directory, and a
 * directory holding anything but old source where a new file goes.
 */
async function planRemovals(
  dir: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Removals> {
  const stat = await fs.lstat(dir).catch(() => null);
  if (stat === null) return { inTheWay: [], rest: [] };
  if (!stat.isDirectory()) {
    throw conflict(
      `The workbench folder is a link or a file, not a directory: ${path.basename(dir)}`,
    );
  }
  const newFiles = new Set([...files.keys()].map(folded));
  const newDirs = new Set([...files.keys()].flatMap(parentsOf).map(folded));
  const stale = (await sourceFiles(dir)).filter((rel) => !files.has(rel));
  const inTheWay = stale.filter(
    (rel) =>
      newFiles.has(folded(rel)) ||
      newDirs.has(folded(rel)) ||
      parentsOf(rel).some((parent) => newFiles.has(folded(parent))),
  );
  const leaving = new Set(inTheWay.map(folded));
  for (const rel of files.keys()) {
    for (const parent of parentsOf(rel)) {
      const at = await fs.lstat(path.join(dir, parent)).catch(() => null);
      if (at === null || (at.isFile() && leaving.has(folded(parent)))) break;
      if (!at.isDirectory()) {
        throw conflict(
          `The workbench folder has a link or a file where the archive needs a directory: ${parent}`,
        );
      }
    }
    const at = await fs.lstat(path.join(dir, rel)).catch(() => null);
    if (!at?.isDirectory()) continue;
    const held = await fs.readdir(path.join(dir, rel), { recursive: true, withFileTypes: true });
    const kept = held.find((entry) => {
      if (entry.isDirectory()) return false;
      const inside = path.relative(dir, path.join(entry.parentPath, entry.name));
      return !leaving.has(folded(inside.split(path.sep).join("/")));
    });
    if (kept !== undefined) {
      throw conflict(
        `The workbench folder has a directory holding more than old source where the archive has a file: ${rel}`,
      );
    }
  }
  return { inTheWay, rest: stale.filter((rel) => !leaving.has(folded(rel))) };
}

/** Removes one old source file, and the directories that leaves empty up to the folder. */
async function removeSource(dir: string, rel: string): Promise<void> {
  await fs.rm(path.join(dir, rel), { force: true });
  for (const parent of parentsOf(rel).reverse()) {
    // The first directory something else still lives in ends the climb.
    const emptied = await fs.rmdir(path.join(dir, parent)).then(
      () => true,
      () => false,
    );
    if (!emptied) break;
  }
}

/**
 * Where an import stages its archive: `.archive.penguin-tmp-<id>-<12 hex>` beside the folders. A
 * dot entry, so never a workbench id: neither the listing nor the watcher sees it.
 */
const STAGING_PREFIX = `.archive${TMP_SUFFIX}-`;

const stagingName = (dir: string): string =>
  `${STAGING_PREFIX}${path.basename(dir)}-${randomBytes(6).toString("hex")}`;

/**
 * Makes `dir`'s source exactly `files`. Everything is checked first (planRemovals) and the
 * archive is written out in full beside the folder, so a refusal or a file the disk will not take
 * leaves the folder as it was. Then old files in the way are removed, each new file is renamed into
 * place, the remaining old source is removed, and `.harness/` goes so the next load writes this
 * host's types — as a plugin update does. `state.json`, `.plugin.json` and `.build/` stay. The
 * archive is staged beside the folder (stagingName); a staging directory untouched for an hour is
 * a crash's leftover and goes first.
 */
export async function writeWorkbenchSource(
  dir: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const removals = await planRemovals(dir, files);
  const base = path.dirname(dir);
  await removeLeftovers(base, STAGING_PREFIX);
  await fs.mkdir(base, { recursive: true });
  const staging = path.join(base, stagingName(dir));
  try {
    for (const [rel, body] of files) {
      await fs.mkdir(path.dirname(path.join(staging, rel)), { recursive: true });
      await fs.writeFile(path.join(staging, rel), body, { flush: true });
    }
    await fs.mkdir(dir, { recursive: true });
    for (const rel of removals.inTheWay) await removeSource(dir, rel);
    for (const rel of files.keys()) {
      const target = path.join(dir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // A directory where the file goes holds no file by now (planRemovals): only empty ones.
      if ((await fs.lstat(target).catch(() => null))?.isDirectory()) {
        await fs.rm(target, { recursive: true });
      }
      await fs.rename(path.join(staging, rel), target);
    }
    for (const rel of removals.rest) await removeSource(dir, rel);
    await fs.rm(path.join(dir, HARNESS_DIR), { recursive: true, force: true });
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
