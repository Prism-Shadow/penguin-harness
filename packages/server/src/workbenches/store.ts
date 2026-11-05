/**
 * Where an Agent's workbenches live and what a folder's revision is.
 *
 *   <agentStateDir>/workbenches/<id>/package.json   `penguin.modules` manifests (a plugin package)
 *   <agentStateDir>/workbenches/<id>/index.ts       default export `{ modules: { <Name>: { create } } }`
 *   <agentStateDir>/workbenches/<id>/ui/            the pages its contributed tabs name
 *   <agentStateDir>/workbenches/<id>/state.json     the workbench's own document (WorkbenchHost.getState)
 *   <agentStateDir>/workbenches/<id>/.harness/      the types it was written against (harness-types.ts)
 *   <agentStateDir>/workbenches/<id>/.build/        its emitted code, per revision (compile.ts)
 *
 * The folder's source is every file except `state.json` (the state is the workbench's data,
 * not its code, and survives a rollback untouched), `node_modules` and the dot entries, which
 * are the server's. Its revision is git's tree id of that source (./repo.ts), so the versions
 * the Agent State repository records carry the same revision. Reading is tolerant: a folder
 * without a package.json is not a workbench.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { removeLeftovers } from "./leftovers.js";
import { blobOid, isGitName, treeId, type SourceFile } from "./repo.js";

export const STATE_FILE = "state.json";
export const UI_DIR = "ui";

export interface WorkbenchFolder {
  id: string;
  dir: string;
  /** Relative paths of the source, sorted (no state.json). */
  files: string[];
  /** Files left out of the source because git refuses their names; a load logs them. */
  refused: string[];
  revision: string;
  uiRev: string | null;
  pkg: { name: string; version: string | null };
}

export { workbenchesDir } from "@prismshadow/penguin-core";

/** A workbench id is one path segment of the folder's own name; nothing else is accepted. */
export function isWorkbenchId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && id !== "." && id !== "..";
}

export function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** A name the folder's source can hold: not the server's (dot entries, staged writes), not installed packages. */
function isSourceName(name: string): boolean {
  return name !== "node_modules" && !name.startsWith(".") && !isTempName(name);
}

/** The workbench's own document at the folder's root, under any case a disk may fold onto it. */
const isStateName = (name: string): boolean => name.toLowerCase() === STATE_FILE;

/**
 * A path inside the folder that is part of its source, and so what a restore may write: nothing
 * at or under `state.json`, and no name git refuses (no version could hold it).
 */
export function isSourcePath(rel: string): boolean {
  const segments = rel.split("/");
  return (
    isSafeRelPath(rel) &&
    !isStateName(segments[0] ?? "") &&
    segments.every((segment) => isSourceName(segment) && !isGitName(segment))
  );
}

/** The folder's source files; a name git refuses goes into `refused` instead. */
async function walk(dir: string, refused: string[], prefix = ""): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!isSourceName(e.name) || (prefix === "" && isStateName(e.name))) continue;
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (isGitName(e.name)) refused.push(rel);
    else if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), refused, rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

async function readFiles(dir: string, files: string[]): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const rel of files) {
    // A file listed a moment ago can be gone by now — an editor's own scratch file, the
    // Agent deleting one mid-write. That is a folder that has changed, not a broken read:
    // what is still there is read, and the watcher brings the next one round.
    try {
      out.push({ rel, body: await fs.readFile(path.join(dir, rel)) });
    } catch {
      continue;
    }
  }
  return out;
}

/** The git tree id of these files: a revision. */
function revisionOf(files: readonly SourceFile[]): string {
  return treeId(files.map((f) => ({ rel: f.rel, oid: blobOid(f.body) })));
}

/** Reads one workbench folder; null when it is not a workbench (no package.json). */
export async function readFolder(dir: string, id: string): Promise<WorkbenchFolder | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
  } catch {
    return null;
  }
  let pkg: { name?: unknown; version?: unknown } = {};
  try {
    pkg = JSON.parse(raw) as typeof pkg;
  } catch {
    // A broken package.json is still a workbench folder: the loader reports the error.
  }
  const refused: string[] = [];
  const files = await walk(dir, refused);
  const source = await readFiles(dir, files);
  // The pages' revision is the tree id of `ui/` itself.
  const ui = source
    .filter((f) => f.rel.startsWith(`${UI_DIR}/`))
    .map((f) => ({ ...f, rel: f.rel.slice(UI_DIR.length + 1) }));
  return {
    id,
    dir,
    files,
    refused: refused.sort(),
    revision: revisionOf(source),
    uiRev: ui.length === 0 ? null : revisionOf(ui),
    pkg: {
      name: typeof pkg.name === "string" && pkg.name !== "" ? pkg.name : id,
      version: typeof pkg.version === "string" ? pkg.version : null,
    },
  };
}

/**
 * The folder's source as it was read: the files on disk now, or null when they no longer have
 * the folder's revision (edited since).
 */
export async function readLoadedSource(folder: WorkbenchFolder): Promise<SourceFile[] | null> {
  const files = await readFiles(folder.dir, folder.files);
  return revisionOf(files) === folder.revision ? files : null;
}

export async function listFolders(base: string): Promise<WorkbenchFolder[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: WorkbenchFolder[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || !isWorkbenchId(e.name)) continue;
    const folder = await readFolder(path.join(base, e.name), e.name);
    if (folder) out.push(folder);
  }
  return out;
}

export async function readState(dir: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, STATE_FILE), "utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * The suffix every staged write of ours carries. It is what tells the watcher and the
 * revision hash that a file is the server's own scratch and not an edit: a fixed
 * `state.json.tmp` was neither — it reloaded the workbench on every `setState`, and entered
 * the hash it was supposed to be outside of. The random middle keeps two concurrent writes
 * from truncating each other's staging file and renaming a half-written document into place.
 */
export const TMP_SUFFIX = ".penguin-tmp";
export const isTempName = (name: string): boolean => name.includes(TMP_SUFFIX);
const tempPath = (file: string) => `${file}${TMP_SUFFIX}${randomBytes(6).toString("hex")}`;

export async function writeState(dir: string, state: unknown): Promise<void> {
  const file = path.join(dir, STATE_FILE);
  const staged = tempPath(file);
  try {
    await fs.writeFile(staged, JSON.stringify(state ?? null, null, 2));
    await fs.rename(staged, file);
  } catch (err) {
    await fs.rm(staged, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** What stands where `rel` goes: a file (or link) in place of one of its directories, or a directory in its place. */
async function blockerOf(dir: string, rel: string): Promise<string | null> {
  const segments = rel.split("/");
  for (let i = 1; i < segments.length; i++) {
    const ancestor = path.join(dir, ...segments.slice(0, i));
    const stat = await fs.lstat(ancestor).catch(() => null);
    if (stat === null) return null;
    if (!stat.isDirectory()) return ancestor;
  }
  const target = path.join(dir, rel);
  return (await fs.lstat(target).catch(() => null))?.isDirectory() ? target : null;
}

const RESTORE_STAGING = `.restore${TMP_SUFFIX}`;

/**
 * Makes the folder's source exactly `files`, or leaves it as it was. The version's files are
 * written aside first; then every current source file, and whatever stands where a file of the
 * version goes (a file where a directory now is, or the reverse), moves aside, and the new files
 * move in. A move that fails puts back everything moved so far. `state.json` and the dot entries
 * are not source and stay where they are. A version holding something other than source (one
 * recorded by hand can hold anything) is refused before anything is written. Should putting back
 * fail too, the previous files are kept in the staging folder the error names.
 */
export async function restoreSource(
  folder: WorkbenchFolder,
  files: readonly SourceFile[],
): Promise<void> {
  const foreign = files.find((f) => !isSourcePath(f.rel));
  if (foreign) throw new Error(`that version holds ${foreign.rel}, which is not workbench source`);
  await removeLeftovers(folder.dir, RESTORE_STAGING);
  const staging = await fs.mkdtemp(path.join(folder.dir, RESTORE_STAGING));
  const incoming = path.join(staging, "new");
  const aside = path.join(staging, "old");
  await fs.mkdir(incoming);
  await fs.mkdir(aside);
  const moved: Array<{ from: string; to: string }> = [];
  const move = async (from: string, to: string) => {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    moved.push({ from, to });
  };
  try {
    for (const [i, file] of files.entries()) {
      await fs.writeFile(path.join(incoming, String(i)), file.body);
    }
    let set = 0;
    for (const rel of folder.files) {
      const current = path.join(folder.dir, rel);
      if (await fs.lstat(current).catch(() => null))
        await move(current, path.join(aside, String(set++)));
    }
    for (const [i, file] of files.entries()) {
      const blocker = await blockerOf(folder.dir, file.rel);
      if (blocker !== null) await move(blocker, path.join(aside, String(set++)));
      await move(path.join(incoming, String(i)), path.join(folder.dir, file.rel));
    }
  } catch (err) {
    try {
      for (const { from, to } of moved.reverse()) {
        await fs.mkdir(path.dirname(from), { recursive: true });
        await fs.rename(to, from);
      }
    } catch (undo) {
      throw new AggregateError(
        [err, undo],
        `The restore failed and the previous files could not all be put back; they are kept in ${aside}.`,
      );
    }
    await fs.rm(staging, { recursive: true, force: true });
    throw err;
  }
  await fs.rm(staging, { recursive: true, force: true });
}
